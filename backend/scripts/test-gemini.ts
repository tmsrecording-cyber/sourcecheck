import { askGeminiJSON } from '../src/lib/gemini';
async function run() {
  try {
    const res = await askGeminiJSON('Return {"test": "hello"}', 50);
    console.log('Success:', res.data);
  } catch (err) {
    console.error('Error:', err);
  }
}
run();
