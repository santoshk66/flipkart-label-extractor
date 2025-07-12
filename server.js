const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ dest: 'uploads/' });

app.post('/split-label-invoice', upload.single('label'), async (req, res) => {
  const buffer = fs.readFileSync(req.file.path);
  const srcDoc = await PDFDocument.load(buffer);
  const newDoc = await PDFDocument.create();

  const totalPages = srcDoc.getPages().length;
  const pages = await srcDoc.copyPages(srcDoc, [...Array(totalPages).keys()]);

  for (let i = 0; i < pages.length; i++) {
    const original = pages[i];

    // Dimensions
    const { width, height } = original.getSize();

    // === Label Page ===
    const labelPage = newDoc.addPage([width * 0.9, height * 0.4]); // keep left/top part
    labelPage.drawPage(original, {
      x: -width * 0.05,   // slight crop from left
      y: -height * 0.6,   // crop bottom
    });

    // === Invoice Page ===
    const invoicePage = newDoc.addPage([width * 0.9, height * 0.55]); // keep bottom part
    invoicePage.drawPage(original, {
      x: -width * 0.05,  // same crop left
      y: -height * 0.05, // crop top just a bit
    });
  }

  const finalPDF = await newDoc.save();
  const outputPath = "public/split_label_invoice.pdf";
  fs.writeFileSync(outputPath, finalPDF);
  fs.unlinkSync(req.file.path);

  res.json({ status: "Done", download: "/split_label_invoice.pdf" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
