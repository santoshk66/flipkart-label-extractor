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

// Ensure public directory exists
const ensurePublicDir = async () => {
  const publicDir = path.join(__dirname, 'public');
  try {
    await fs.mkdir(publicDir, { recursive: true });
  } catch (err) {
    console.error('Error creating public directory:', err);
  }
};

// Ensure uploads directory exists
const ensureUploadsDir = async () => {
  const uploadsDir = path.join(__dirname, 'Uploads');
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
  } catch (err) {
    console.error('Error creating uploads directory:', err);
  }
};

const upload = multer({
  dest: 'Uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
});

// Crop dimensions (adjust these values based on your PDF layout)
const CROP = {
  left: 30,   // Pixels to crop from left
  right: 30,  // Pixels to crop from right
  top: 50,    // Pixels to crop from top
  bottom: 50  // Pixels to crop from bottom
};

app.post('/process-labels', upload.single('label'), async (req, res) => {
  await ensurePublicDir();
  await ensureUploadsDir();

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  try {
    const buffer = await fs.readFile(req.file.path);
    const data = await pdfParse(buffer);
    const textPerPage = data.text.split(/\f/);

    const srcDoc = await PDFDocument.load(buffer);
    const font = await srcDoc.embedFont(StandardFonts.Helvetica);
    const labelDoc = await PDFDocument.create();
    const invoiceDoc = await PDFDocument.create();

    let sku = "default";

    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const pageText = textPerPage[i] || "";
      const originalPage = srcDoc.getPage(i);
      const { width, height } = originalPage.getSize();
      
      // Calculate cropped dimensions
      const cropWidth = width - CROP.left - CROP.right;
      const cropHeight = height - CROP.top - CROP.bottom;

      if (cropWidth <= 0 || cropHeight <= 0) {
        throw new Error('Crop dimensions result in invalid page size');
      }

      const embedded = await Promise.all([
        labelDoc.embedPage(originalPage),
        invoiceDoc.embedPage(originalPage)
      ]);
      const embeddedPage = embedded[0]; // Same for both docs

      if (pageText.includes("Tax Invoice")) {
        const invoicePage = invoiceDoc.addPage([cropWidth, cropHeight]);
        invoicePage.drawPage(embeddedPage, {
          x: -CROP.left,
          y: -CROP.bottom
        });
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
      }
    }

    // Save both PDFs
    const labelFileName = `labels_${uuidv4()}.pdf`;
    const invoiceFileName = `invoices_${uuidv4()}.pdf`;
    const labelFilePath = path.join(__dirname, 'public', labelFileName);
    const invoiceFilePath = path.join(__dirname, 'public', invoiceFileName);

    if (labelDoc.getPageCount() > 0) {
      const labelBytes = await labelDoc.save();
      await fs.writeFile(labelFilePath, labelBytes);
    }
    if (invoiceDoc.getPageCount() > 0) {
      const invoiceBytes = await invoiceDoc.save();
      await fs.writeFile(invoiceFilePath, invoiceBytes);
    }

    // Clean up uploaded file
    await fs.unlink(req.file.path).catch(err => console.error('Error deleting uploaded file:', err));

    res.json({
      status: 'success',
      labelDownload: labelDoc.getPageCount() > 0 ? `/${labelFileName}` : null,
      invoiceDownload: invoiceDoc.getPageCount() > 0 ? `/${invoiceFileName}` : null
    });
  } catch (err) {
    console.error('Processing error:', err);
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  ensurePublicDir();
  ensureUploadsDir();
});
