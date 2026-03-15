import { execSync } from 'node:child_process';
import { basename } from 'node:path';

const ALLOWED_ENV_FILES = new Set([
  '.env.example',
  'backend/.env.example',
]);

const isSecretEnvFile = (name) => {
  if (!name.startsWith('.env')) {
    return false;
  }

  return name !== '.env.example';
};

// Use git to enumerate the package surface: tracked files plus any untracked
// files that are not excluded by .gitignore.  This mirrors what would actually
// be present in a shared source package (git archive / zip of working tree
// minus ignored files), so gitignored local secret files are correctly absent.
let packageFiles;
try {
  packageFiles = execSync('git ls-files --cached --others --exclude-standard', {
    encoding: 'utf8',
    cwd: process.cwd(),
  })
    .trim()
    .split('\n')
    .filter(Boolean);
} catch {
  console.error('Release secret scan failed: could not enumerate package files via git.');
  process.exit(1);
}

const forbiddenFiles = packageFiles.filter((relPath) => {
  if (ALLOWED_ENV_FILES.has(relPath)) {
    return false;
  }
  return isSecretEnvFile(basename(relPath));
});

if (forbiddenFiles.length > 0) {
  console.error('Release secret scan failed: local secret env files are present in the package/share path.');
  forbiddenFiles.forEach((filePath) => {
    console.error(`- ${filePath}`);
  });
  process.exit(1);
}

console.log('Release secret scan passed: no local secret env files found in the package/share path.');
