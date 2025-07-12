const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument, PDFPage } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'Uploads');

const ensureDir = async (dir) => {
  try {
    await fs.mkdir(dir, { recursive: true });
    console.log(`Directory created: ${dir}`);
  } catch (err) {
    console.error(`Failed to create directory ${dir}:`, err);
  }
};

// Initialize directories
Promise.all([
  ensureDir(publicDir),
  ensureDir(uploadsDir)
]);

const upload = multer({
  dest: uploadsDir,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

app.post('/split-label-invoice', upload.single('label'), async (req, res) => {
  if (!req.file) {
    console.error('No file uploaded');
    return res.status(400).json({ error: 'No PDF file uploaded.' });
  }

  try {
    console.log(`Processing file: ${req.file.path}`);
    const buffer = await fs.readFile(req.file.path);
    console.log('File read successfully');

    const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: false });
    console.log('PDF loaded successfully');

    if (srcDoc.isEncrypted) {
      throw new Error('Uploaded PDF is encrypted. Please upload an unencrypted PDF.');
    }

    const totalPages = srcDoc.getPageCount();
    console.log(`Total pages: ${totalPages}`);

    if (totalPages === 0) {
      throw new Error('PDF has no pages.');
    }

    const newDoc = await PDFDocument.create();
    const pageIndices = [...Array(totalPages).keys()];
    let pages;
    try {
      pages = await srcDoc.copyPages(srcDoc, pageIndices);
      console.log(`Copied ${pages.length} pages`);
    } catch (copyError) {
      throw new Error(`Failed to copy pages: ${copyError.message}`);
    }

    let validPagesProcessed = 0;

    for (let i = 0; i < pages.length; i++) {
      const original = pages[i];

      let width, height;
      try {
        ({ width, height } = original.getSize());
        console.log(`Page ${i + 1} dimensions: ${width}x${height}`);
      } catch (sizeError) {
        console.warn(`Skipping page ${i + 1}: Failed to get dimensions - ${sizeError.message}`);
        continue;
      }

      // Validate dimensions
      if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        console.warn(`Skipping page ${i + 1}: Invalid dimensions (width: ${width}, height: ${height})`);
        continue;
      }

      try {
        // Crop margins: 10% from left and right, 5% from top/bottom
        const cropMarginX = width * 0.1; // 10% from each side
        const croppedWidth = width * 0.8; // 80% of original width
        const cropMarginY = height * 0.05; // 5% from top/bottom

        // Label Page (top ~40% of the page, cropped)
        const labelHeight = height * 0.4;
        const labelPage = newDoc.addPage([croppedWidth, labelHeight]);
        labelPage.drawPage(original, {
          x: -cropMarginX, // Crop left margin
          y: -(height - labelHeight - cropMarginY), // Align to top, crop bottom
          width: width,
          height: height
        });
        console.log(`Added label page ${i + 1}: ${croppedWidth}x${labelHeight}`);

        // Invoice Page (bottom ~60% of the page, cropped)
        const invoiceHeight = height * 0.6;
        const invoicePage = newDoc.addPage([croppedWidth, invoiceHeight]);
        invoicePage.drawPage(original, {
          x: -cropMarginX, // Crop left margin
          y: -cropMarginY, // Align to bottom, crop top
          width: width,
          height: height
        });
        console.log(`Added invoice page ${i + 1}: ${croppedWidth}x${invoiceHeight}`);

        validPagesProcessed += 2;
      } catch (drawError) {
        console.warn(`Failed to process page ${i + 1}: ${drawError.message}`);
        // Fallback: Add the full page without cropping
        try {
          const fullPage = newDoc.addPage([width, height]);
          fullPage.drawPage(original, { x: 0, y: 0, width, height });
          console.log(`Added full page ${i + 1} as fallback: ${width}x${height}`);
          validPagesProcessed += 1;
        } catch (fallbackError) {
          console.warn(`Failed to add full page ${i + 1} as fallback: ${fallbackError.message}`);
          continue;
        }
      }
    }

    if (validPagesProcessed === 0) {
      throw new Error('No valid pages were processed. Please check the input PDF for content or compatibility.');
    }

    console.log(`Total pages in output PDF: ${newDoc.getPageCount()}`);
    const finalPDF = await newDoc.save();
    if (finalPDF.length < 100) { // Arbitrary threshold for empty PDF
      throw new Error('Generated PDF is empty or too small. No content was rendered.');
    }

    const uniqueId = uuidv4();
    const outputPath = path.join(publicDir, `split_label_invoice_${uniqueId}.pdf`);
    console.log(`Writing output to: ${outputPath}`);
    await fs.writeFile(outputPath, finalPDF);

    // Clean up uploaded file
    await fs.unlink(req.file.path).catch(err => console.error('Failed to delete temp file:', err));

    res.json({ status: 'Done', download: `/split_label_invoice_${uniqueId}.pdf` });
  } catch (error) {
    console.error('Error processing PDF:', error.message, error.stack);
    // Clean up uploaded file on error
    await fs.unlink(req.file.path).catch(err => console.error('Failed to delete temp file:', err));
    res.status(500).json({ error: `Failed to process PDF: ${error.message}` });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
