const axios = require('axios');

async function generateStory(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Missing GEMINI_API_KEY');
    return '';
  }
  try {
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              { text: `請根據以下主題生成一段約 50 字的中文短篇故事。\n\n主題：「${prompt}」` }
            ]
          }
        ]
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const candidates = resp.data?.candidates;
    const story = candidates?.[0]?.content?.parts?.[0]?.text || '';
    return story.trim();
  } catch (err) {
    console.error('Error calling Gemini API:', err?.response?.data || err);
    return '';
  }
}

(async () => {
  const prompt = process.argv.slice(2).join(' ');
  if (!prompt) {
    console.error('Usage: node generateStory.js <prompt>');
    process.exit(1);
  }
  const story = await generateStory(prompt);
  if (story) console.log(story);
})();

