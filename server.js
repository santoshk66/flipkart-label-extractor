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

// Crop dimensions (adjust based on your PDF layout)
const CROP = {
  left: 30,
  right: 30,
  top: 50,
  bottom: 50
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

    const labelDoc = await PDFDocument.create();
    const invoiceDoc = await PDFDocument.create();
    const font = await Promise.all([
      labelDoc.embedFont(StandardFonts.Helvetica),
      invoiceDoc.embedFont(StandardFonts.Helvetica)
    ]).then(fonts => fonts[0]);

    let sku = "default";

    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const pageText = textPerPage[i] || "";
      const originalPage = srcDoc.getPage(i);
      const { width, height } = originalPage.getSize();

      const cropWidth = width - CROP.left - CROP.right;
      const cropHeight = height - CROP.top - CROP.bottom;

      if (cropWidth <= 0 || cropHeight <= 0) {
        throw new Error(`Invalid crop dimensions for page ${i + 1}: width=${cropWidth}, height=${cropHeight}`);
      }

      const embeddedPage = await Promise.all([
        labelDoc.embedPage(originalPage),
        invoiceDoc.embedPage(originalPage)
      ]).then(pages => pages[0]);

      if (pageText.includes("Tax Invoice")) {
        const invoicePage = invoiceDoc.addPage([cropWidth, cropHeight]);
        invoicePage.drawPage(embeddedPage, {
          x: -CROP.left,
          y: -CROP.bottom
        });
        console.log(`Page ${i + 1} added to invoiceDoc`);
      } else {
        const labelPage = labelDoc.addPage([cropWidth, cropHeight]);
        labelPage.drawPage(embeddedPage, {
          x: -CROP.left,
          y: -CROP.bottom
        });

        const match = pageText.match(/SKU ID\s*\|\s*Description.*?(\w+)/);
        if (match) sku = match[1];

        labelPage.drawText(`SKU: ${sku}`, {
          x: 20,
          y: cropHeight - 30,
          size: 12,
          font: font,
          color: rgb(0, 0, 0)
        });
        console.log(`Page ${i + 1} added to labelDoc with SKU: ${sku}`);
      }
    }

    const labelFileName = labelDoc.getPageCount() > 0 ? `labels_${uuidv4()}.pdf` : null;
    const invoiceFileName = invoiceDoc.getPageCount() > 0 ? `invoices_${uuidv4()}.pdf` : null;
    const labelFilePath = labelFileName ? path.join(publicDir, labelFileName) : null;
    const invoiceFilePath = invoiceFileName ? path.join(publicDir, invoiceFileName) : null;

    if (labelFilePath) {
      const labelBytes = await labelDoc.save();
      await fs.writeFile(labelFilePath, labelBytes);
      console.log(`Labels saved to: ${labelFilePath}`);
    }
    if (invoiceFilePath) {
      const invoiceBytes = await invoiceDoc.save();
      await fs.writeFile(invoiceFilePath, invoiceBytes);
      console.log(`Invoices saved to: ${invoiceFilePath}`);
    }

    if (!labelFileName && !invoiceFileName) {
      throw new Error('No valid pages found to process.');
    }

    res.json({
      status: 'success',
      labelDownload: labelFileName ? `/${labelFileName}` : null,
      invoiceDownload: invoiceFileName ? `/${invoiceFileName}` : null
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
