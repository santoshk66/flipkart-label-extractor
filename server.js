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
const ensureDir = async (dir) => {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create directory ${dir}:`, err);
  }
};

// Initialize directories
Promise.all([
  ensureDir(path.join(__dirname, 'public')),
  ensureDir(path.join(__dirname, 'uploads'))
]);

const upload = multer({
  dest: 'uploads/',
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
    return res.status(400).json({ error: 'No PDF file uploaded.' });
  }

  try {
    const buffer = await fs.readFile(req.file.path);
    const srcDoc = await PDFDocument.load(buffer);
    const newDoc = await PDFDocument.create();

    const totalPages = srcDoc.getPages().length;
    const pages = await srcDoc.copyPages(srcDoc, [...Array(totalPages).keys()]);

    for (let i = 0; i < pages.length; i++) {
      const original = pages[i];
      const { width, height } = original.getSize();

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
    const outputPath = path.join(__dirname, 'public', `split_label_invoice_${uniqueId}.pdf`);
    await fs.writeFile(outputPath, finalPDF);

    // Clean up uploaded file
    await fs.unlink(req.file.path).catch(err => console.error('Failed to delete temp file:', err));

    res.json({ status: 'Done', download: `/split_label_invoice_${uniqueId}.pdf` });
  } catch (error) {
    console.error('Error processing PDF:', error);
    // Clean up uploaded file on error
    await fs.unlink(req.file.path).catch(err => console.error('Failed to delete temp file:', err));
    res.status(500).json({ error: 'Failed to process PDF.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
