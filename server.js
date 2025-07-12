const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
const ensureDir = async (dir) => {
  try {
    await fs.mkdir(dir, { recursive: true });
    console.log(`Directory ensured: ${dir}`);
  } catch (err) {
    console.error(`Error creating directory ${dir}:`, err);
  }
};

const upload = multer({
  dest: 'Uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Crop dimensions (tight cropping for labels and invoices)
const CROP = {
  left: 50,
  right: 50,
  top: 80,
  bottom: 80
};

app.post('/process-labels', upload.single('label'), async (req, res) => {
  const publicDir = path.join(__dirname, 'public');
  const uploadsDir = path.join(__dirname, 'Uploads');
  await Promise.all([ensureDir(publicDir), ensureDir(uploadsDir)]);

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const filePath = req.file.path;
  try {
    console.log('Processing file:', filePath);
    const buffer = await fs.readFile(filePath);
    const srcDoc = await PDFDocument.load(buffer).catch(err => {
      throw new Error(`Failed to load PDF: ${err.message}`);
    });

    if (srcDoc.getPageCount() === 0) {
      throw new Error('PDF contains no pages.');
    }

    const data = await pdfParse(buffer).catch(err => {
      throw new Error(`Failed to parse PDF: ${err.message}`);
    });
    const textPerPage = data.text.split(/\f/);

    const outputDoc = await PDFDocument.create();
    const font = await outputDoc.embedFont(StandardFonts.Helvetica);

    // Separate labels and invoices
    const labels = [];
    const invoices = [];
    let sku = "default";

    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const pageText = textPerPage[i] || "";
      const originalPage = srcDoc.getPage(i);
      const { width, height } = originalPage.getSize();

      // Validate crop dimensions
      const cropWidth = width - CROP.left - CROP.right;
      const cropHeight = height - CROP.top - CROP.bottom;
      if (cropWidth <= 0 || cropHeight <= 0) {
        console.warn(`Skipping page ${i + 1}: Invalid crop dimensions (width=${cropWidth}, height=${cropHeight})`);
        continue;
      }

      const embeddedPage = await outputDoc.embedPage(originalPage);

      if (pageText.includes("Tax Invoice")) {
        invoices.push({ embeddedPage, cropWidth, cropHeight });
        console.log(`Page ${i + 1} identified as invoice`);
      } else if (pageText.match(/SKU ID\s*\|\s*Description/)) {
        const match = pageText.match(/SKU ID\s*\|\s*Description.*?(\w+)/);
        if (match) sku = match[1];
        labels.push({ embeddedPage, cropWidth, cropHeight, sku });
        console.log(`Page ${i + 1} identified as label with SKU: ${sku}`);
      } else {
        console.log(`Page ${i + 1} skipped: Not a label or invoice`);
      }
    }

    if (labels.length === 0 && invoices.length === 0) {
      throw new Error('No valid label or invoice pages found in the PDF.');
    }

    // Alternate labels and invoices
    const maxLength = Math.max(labels.length, invoices.length);
    for (let i = 0; i < maxLength; i++) {
      if (i < labels.length) {
        const { embeddedPage, cropWidth, cropHeight, sku } = labels[i];
        const labelPage = outputDoc.addPage([cropWidth, cropHeight]);
        labelPage.drawPage(embeddedPage, {
          x: -CROP.left,
          y: -CROP.bottom
        });
        labelPage.drawText(`SKU: ${sku}`, {
          x: 10,
          y: cropHeight - 20,
          size: 10,
          font: font,
          color: rgb(0, 0, 0)
        });
        console.log(`Added label page ${i + 1} to output`);
      }
      if (i < invoices.length) {
        const { embeddedPage, cropWidth, cropHeight } = invoices[i];
        const invoicePage = outputDoc.addPage([cropWidth, cropHeight]);
        invoicePage.drawPage(embeddedPage, {
          x: -CROP.left,
          y: -CROP.bottom
        });
        console.log(`Added invoice page ${i + 1} to output`);
      }
    }

    const fileName = `processed_${uuidv4()}.pdf`;
    const filePath = path.join(publicDir, fileName);
    const bytes = await outputDoc.save();
    await fs.writeFile(filePath, bytes);
    console.log(`Output saved to: ${filePath}`);

    res.json({
      status: 'success',
      download: `/${fileName}`
    });
  } catch (err) {
    console.error('Processing error:', err);
    res.status(500).json({ error: `Failed to process PDF: ${err.message}` });
  } finally {
    await fs.unlink(filePath).catch(err => console.error('Error deleting uploaded file:', err));
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await Promise.all([
    ensureDir(path.join(__dirname, 'public')),
    ensureDir(path.join(__dirname, 'Uploads'))
  ]);
});
