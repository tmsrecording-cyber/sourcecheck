import { askGeminiJSON } from '../src/lib/gemini';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
async function run() {
  try {
    const res = await askGeminiJSON('Return {"test": "hello"}', 50);
    console.log('Success:', res.data);
  } catch (err) {
    console.error('Error:', err);
  }
}
run();
