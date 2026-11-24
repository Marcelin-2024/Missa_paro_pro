import fs from 'fs';
import path from 'path';

export interface FormField {
  name: string;
  label: string;
  placeholder?: string;
  type: string;
  options?: [string, string][];
  width?: string;
  required?: boolean;
}

export interface LoginJsonConfig {
  inscription_champs: FormField[];
  connection: FormField[];
  messes: FormField[];
  annonces: FormField[];
}

export function loadFormConfig(): LoginJsonConfig {
  const jsonPath = path.join(process.cwd(), 'public', 'json', 'login.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  return JSON.parse(raw) as LoginJsonConfig;
}
