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

  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const filePath = req.file.path;
  try {
    const buffer = await fs.readFile(filePath);
    const srcDoc = await PDFDocument.load(buffer);
    const outputDoc = await PDFDocument.create();

    // ✅ Define CROP map for label/invoice pages
    const CROP = {
      label: { left: 35, right: 35, top: 20, bottom: 20 },
      invoice: { left: 20, right: 20, top: 10, bottom: 10 }
    };

    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const originalPage = srcDoc.getPage(i);
      const { width, height } = originalPage.getSize();
      const embeddedPage = await outputDoc.embedPage(originalPage);

      const isLabel = i % 2 === 0;
      const crop = isLabel ? CROP.label : CROP.invoice;

      const cropWidth = width - crop.left - crop.right;
      const cropHeight = height - crop.top - crop.bottom;

      const newPage = outputDoc.addPage([cropWidth, cropHeight]);
      newPage.drawPage(embeddedPage, {
        x: -crop.left,
        y: -crop.bottom
      });

      console.log(`Page ${i + 1} processed as ${isLabel ? 'Label' : 'Invoice'}`);
    }

    const fileName = `processed_${uuidv4()}.pdf`;
    const filePathOutput = path.join(publicDir, fileName);
    const finalBytes = await outputDoc.save();
    await fs.writeFile(filePathOutput, finalBytes);

    res.json({ status: 'success', download: `/${fileName}` });
  } catch (err) {
    console.error('Processing error:', err);
    res.status(500).json({ error: `Failed to process PDF: ${err.message}` });
  } finally {
    if (filePath) await fs.unlink(filePath).catch(console.error);
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
