const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

const API_URL = 'https://ai-image-api.xeven.workers.dev/img';

app.post('/generate', async (req, res) => {
  const { prompt } = req.body;

  try {
    const response = await axios.get(API_URL, {
      params: { prompt },
      responseType: 'arraybuffer',
    });

    const imageBuffer = Buffer.from(response.data, 'binary');
    const imagePath = path.join(__dirname, '../public/generated-image.png');
    fs.writeFileSync(imagePath, imageBuffer);

    res.json({ imageUrl: '/generated-image.png' });
  } catch (error) {
    console.error('Error generating image:', error);
    res.status(500).send('Failed to generate image');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
