import axios from "axios";

// Downloads a file from the API with the session cookie (works locally and through the Vercel proxy).
// The server names the file in Content-Disposition; `fallbackName` is used when it can't be read.
export const downloadFile = async (url, fallbackName) => {
  const response = await axios.get(url, { withCredentials: true, responseType: "blob" });
  const disposition = response.headers["content-disposition"] || "";
  const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || fallbackName;
  const objectUrl = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
