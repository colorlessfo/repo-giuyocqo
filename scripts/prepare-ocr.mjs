import { mkdir, cp, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const out = path.resolve('public/ocr');
await mkdir(out, { recursive: true });
await copyFile(require.resolve('tesseract.js/dist/worker.min.js'), path.join(out, 'worker.min.js'));
await cp(path.dirname(require.resolve('tesseract.js-core/package.json')), path.join(out, 'core'), {
  recursive: true,
});
for (const language of ['eng', 'chi_sim']) {
  const directory = path.dirname(require.resolve(`@tesseract.js-data/${language}/package.json`));
  await copyFile(
    path.join(directory, `4.0.0_best_int/${language}.traineddata.gz`),
    path.join(out, `${language}.traineddata.gz`),
  );
}
console.log('中文和英文 OCR 模型已准备好，识别时图片无需离开浏览器。');
