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
  left: 70,
  right: 70,
  top: 120,
  bottom: 120
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
      const isLabel = i % 2 === 0; // Odd pages (0-based index) are labels
      const pageType = isLabel ? 'label' : 'invoice';

      const newPage = outputDoc.addPage([cropWidth, cropHeight]);
      newPage.drawPage(embeddedPage, {
        x: -CROP.left,
        y: -CROP.bottom
      });

      if (isLabel) {
        let sku = "Unknown";
        const match = pageText.match(/SKU\s*[:|\s-]*([A-Za-z0-9-]+)/i) || pageText.match(/([A-Za-z0-9-]{6,})/);
        if (match && match[1] && match[1].toLowerCase() !== 'qty' && !match[1].match(/^[0-9\s.]+$/)) {
          sku = match[1];
        }

        newPage.drawText(`SKU: ${sku}`, {
          x: 10,
          y: cropHeight - 20,
          size: 10,
          font: font,
          color: rgb(0, 0, 0)
        });
        console.log(`Page ${i + 1} added as label with SKU: ${sku}`);
      } else {
        console.log(`Page ${i + 1} added as invoice`);
      }
    }

    if (outputDoc.getPageCount() === 0) {
      throw new Error('No valid pages processed.');
    }

    const fileName = `processed_${uuidv4()}.pdf`;
    const filePathOutput = path.join(publicDir, fileName);
    const bytes = await outputDoc.save();
    await fs.writeFile(filePathOutput, bytes);
    console.log(`Output saved to: ${filePathOutput}`);

    res.json({
      status: 'success',
      download: `/${fileName}`
    });
  } catch (err) {
    console.error('Processing error:', err);
    res.status(500).json({ error: `Failed to process PDF: ${err.message}` });
  } finally {
    if (filePath) {
      await fs.unlink(filePath).catch(err => console.error('Error deleting uploaded file:', err));
    }
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
