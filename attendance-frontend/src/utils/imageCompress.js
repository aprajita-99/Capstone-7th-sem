// Shrinks a photo in the browser to a JPEG data URL under maxBytes (default
// 600 KB): longest side ≤ maxSide px, then lower quality until it fits.
const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not an image the browser can read. Try a JPEG or PNG photo."));
    };
    image.src = url;
  });

const dataUrlBytes = (dataUrl) => Math.ceil(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

export const compressImage = async (file, { maxBytes = 600 * 1024, maxSide = 1600 } = {}) => {
  const image = await loadImage(file);
  let scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));

  for (let round = 0; round < 6; round += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.75, 0.65, 0.55]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrlBytes(dataUrl) <= maxBytes) return dataUrl;
    }
    scale *= 0.75;
  }
  throw new Error("Could not make this photo small enough. Try a different photo.");
};
