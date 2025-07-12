const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');

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
    const pages = await srcDoc.copyPages(srcDoc, pageIndices);
    console.log(`Copied ${pages.length} pages`);

    for (let i = 0; i < pages.length; i++) {
      const original = pages[i];
      if (!original || typeof original.getSize !== 'function') {
        throw new Error(`Invalid page object at index ${i}`);
      }

      const { width, height } = original.getSize();
      console.log(`Page ${i + 1} dimensions: ${width}x${height}`);

      // Validate dimensions
      if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
        throw new Error(`Invalid page dimensions for page ${i + 1} (width: ${width}, height: ${height})`);
      }

      // Label Page (top 40% of the page)
      const labelPage = newDoc.addPage([width * 0.9, height * 0.4]);
      labelPage.drawPage(original, {
        x: -width * 0.05, // slight crop from left
        y: -height * 0.6  // crop bottom
      });

      // Invoice Page (bottom 55% of the page)
      const invoicePage = newDoc.addPage([width * 0.9, height * 0.55]);
      invoicePage.drawPage(original, {
        x: -width * 0.05, // slight crop left
        y: -height * 0.05 // crop top slightly
      });
    }

    const finalPDF = await newDoc.save();
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
