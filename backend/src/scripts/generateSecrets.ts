import { randomBytes, randomInt } from 'node:crypto';

const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const lower = 'abcdefghijkmnopqrstuvwxyz';
const digits = '23456789';
const symbols = '!@#$%^&*()-_=+';

const pickFrom = (alphabet: string): string => {
  return alphabet[randomInt(0, alphabet.length)] || '';
};

const shuffle = (input: string[]): string[] => {
  const output = [...input];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(0, index + 1);
    const current = output[index];
    output[index] = output[randomIndex] || '';
    output[randomIndex] = current || '';
  }

  return output;
};

const generateJwtSecret = (): string => {
  return randomBytes(48).toString('base64url');
};

const generateAdminPassword = (): string => {
  const required = [
    pickFrom(upper),
    pickFrom(lower),
    pickFrom(digits),
    pickFrom(symbols),
  ];
  const all = `${upper}${lower}${digits}${symbols}`;
  const additional = Array.from({ length: 16 }, () => pickFrom(all));

  return shuffle([...required, ...additional]).join('');
};

const jwtSecret = generateJwtSecret();
const adminPassword = generateAdminPassword();

console.log('Generated secure values:');
console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`BOOTSTRAP_ADMIN_PASSWORD=${adminPassword}`);
console.log('\nDo not commit these values. Store them in your secret manager.');
