
const cleanJsonSyntax = (value) => {
  return value.replace(/,(\s*[}\]])/g, '$1');
};

const buggyInput = '{"text": "Hello, ]"}';
const result = cleanJsonSyntax(buggyInput);
console.log('Input:', buggyInput);
console.log('Result:', result);
if (result === '{"text": "Hello ]"}') {
  console.log('BUG DETECTED: String content was corrupted.');
} else {
  console.log('No bug detected.');
}
