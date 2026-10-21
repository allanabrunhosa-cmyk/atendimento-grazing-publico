// PNG de um pixel e WebP 512x512 produzidos sem dados reais; AMR contém quadro SID.
export const pngFicticio=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xkAAAAASUVORK5CYII=','base64');
export const webpFicticio=Buffer.from('UklGRi4AAABXRUJQVlA4TCIAAAAv/8F/AAdQhfKUrP8BgUCyv/cMRfQ/4z//+c9//vOf//wf','base64');
export const webpAnimadoFicticio=Buffer.from('UklGRogAAABXRUJQVlA4WAoAAAACAAAA/wEA/wEAQU5JTQYAAAAAAAAAAABBTk1GKgAAAAAAAAAAAP8BAP8BAGQAAAJWUDhMEQAAAC//wX8AB1CF8pSs/4GI6H8AAEFOTUYqAAAAAAAAAAAA/wEA/wEAZAAAAFZQOEwRAAAAL//BfwAHUI9CFa//gYjofwAA','base64');
export const amrFicticio=Buffer.concat([Buffer.from('#!AMR\n'),Buffer.from([68,0,0,0,0,0])]);
// Fronteira fictícia de contêiner: o codec de um vídeo real ainda é validado pela Meta.
export const mp4Ficticio=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
export const pdfFicticio=Buffer.from('%PDF-1.4\nDocumento de teste sem dados reais');
