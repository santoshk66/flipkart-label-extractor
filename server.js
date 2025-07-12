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

// Multer setup
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

app.post('/split-label-invoice', upload.single('label'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const buffer = await fs.readFile(req.file.path);
    const srcDoc = await PDFDocument.load(buffer);
    if (srcDoc.isEncrypted) throw new Error('PDF is encrypted.');

    const newDoc = await PDFDocument.create();
    const totalPages = srcDoc.getPageCount();
    const pageIndices = [...Array(totalPages).keys()];
    const pages = await srcDoc.copyPages(srcDoc, pageIndices);
    let processed = 0;

    for (let i = 0; i < pages.length; i++) {
      const original = pages[i];
      const { width, height } = original.getSize();
      const marginX = width * 0.1, marginY = height * 0.05;
      const usableWidth = width * 0.8;

      // Label (top 40%)
      const labelHeight = height * 0.4;
      const labelPage = newDoc.addPage([usableWidth, labelHeight]);
      labelPage.drawPage(original, {
        x: -marginX,
        y: -(height - labelHeight - marginY),
        width,
        height
      });

      // Invoice (bottom 60%)
      const invoiceHeight = height * 0.6;
      const invoicePage = newDoc.addPage([usableWidth, invoiceHeight]);
      invoicePage.drawPage(original, {
        x: -marginX,
        y: -marginY,
        width,
        height
      });

      processed += 2;
    }

    if (processed === 0) throw new Error('No valid pages processed.');
    const outputPdf = await newDoc.save();
    const outputName = `split_label_invoice_${uuidv4()}.pdf`;
    const outputPath = path.join(__dirname, 'public', outputName);
    await fs.writeFile(outputPath, outputPdf);
    await fs.unlink(req.file.path).catch(() => {});

    res.json({ status: 'Done', download: `/${outputName}` });
  } catch (err) {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
