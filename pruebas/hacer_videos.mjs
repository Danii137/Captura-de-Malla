// Monta con FFmpeg los vídeos y animaciones del README:
//  - demo del flujo (fotogramas de video_demo.mjs) → MP4 1280×720 con rótulos + animación ligera
//  - giro del modelo (fotogramas de blender_giro.py) → MP4 + animación ligera
// Uso: node hacer_videos.mjs <carpeta_demo> <carpeta_giro> <carpeta_docs>
// Necesita FFmpeg (en el PATH o instalado con winget: Gyan.FFmpeg).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [, , DEMO, GIRO, DOCS] = process.argv;
if (!DEMO || !GIRO || !DOCS) { console.log('Uso: node hacer_videos.mjs <carpeta_demo> <carpeta_giro> <carpeta_docs>'); process.exit(1); }
const FF = (() => {
  const w = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe');
  return spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : w;
})();
const VID = path.join(DOCS, 'video'), IMG = path.join(DOCS, 'img');
fs.mkdirSync(VID, { recursive: true }); fs.mkdirSync(IMG, { recursive: true });
function ff(args, cwd) {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('FFmpeg: ' + (r.stderr || r.error));
}
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2) + ' MB';
// rótulos: letra Segoe UI (la de Windows), copiada junto a los fotogramas para no lidiar con «C:» en el filtro
fs.copyFileSync('C:/Windows/Fonts/segoeuib.ttf', path.join(DEMO, 'letra.ttf'));
const tramos = JSON.parse(fs.readFileSync(path.join(DEMO, 'tramos.json'), 'utf8'));
const rotulos = tramos.map((tr, i) => {
  fs.writeFileSync(path.join(DEMO, `rotulo_${i}.txt`), `${i + 1} · ${tr.texto}`);
  return `drawtext=fontfile=letra.ttf:textfile=rotulo_${i}.txt:fontsize=28:fontcolor=white:box=1:boxcolor=0x14212bdd:boxborderw=14:x=(w-text_w)/2:y=h-th-34:enable='between(t,${tr.inicio.toFixed(2)},${tr.fin.toFixed(2)})'`;
});
const encaje = (W, H) => `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x1b2025,setsar=1`;
// 1) demo en MP4 (con rótulos)
const demoMp4 = path.join(VID, 'demo.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-vf', `${encaje(1280, 720)},fps=30,${rotulos.join(',')}`,
  '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.resolve(demoMp4)], DEMO);
console.log('demo.mp4', mb(demoMp4));
// 2) giro en MP4 (24 fotogramas por segundo)
const giroMp4 = path.join(VID, 'giro.mp4');
ff(['-framerate', '24', '-i', path.join(GIRO, 'f_%03d.png'), '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.resolve(giroMp4)]);
console.log('giro.mp4', mb(giroMp4));
// 3) animaciones para el README, a partir de los MP4: WebP animado (se ve como un GIF en GitHub y pesa unas
//    4 veces menos: demo 3,1 MB frente a 12,2 MB; giro 6,8 frente a 27,9). Con GIF=1 se hace también el GIF.
function anim(src, base, W, fps, quality) {
  const webp = path.join(IMG, base + '.webp');
  ff(['-i', path.resolve(src), '-vf', `fps=${fps},scale=${W}:-2:flags=lanczos`, '-c:v', 'libwebp_anim', '-quality', String(quality), '-compression_level', '6', '-loop', '0', path.resolve(webp)]);
  let txt = `${base}.webp ${mb(webp)}`;
  if (process.env.GIF) {
    const gif = path.join(IMG, base + '.gif');
    ff(['-i', path.resolve(src), '-vf', `fps=${fps},scale=${W}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, '-loop', '0', path.resolve(gif)]);
    txt += ` · ${base}.gif ${mb(gif)}`;
  }
  console.log(txt);
}
anim(demoMp4, 'demo', 960, 12, 70);
anim(giroMp4, 'giro', 720, 15, 60);
