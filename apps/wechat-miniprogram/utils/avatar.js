const MAX_AVATAR_BYTES = 128 * 1024;

function compressAvatar(filePath) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality: 70,
      compressedWidth: 256,
      compressedHeight: 256,
      success: (result) => resolve(result.tempFilePath),
      fail: () => reject(new Error('头像处理失败，请重新选择'))
    });
  });
}

function imageType(filePath) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success: (result) => resolve(result.type === 'jpg' ? 'jpeg' : result.type),
      fail: () => reject(new Error('无法识别头像格式'))
    });
  });
}

function readBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (result) => resolve(result.data),
      fail: () => reject(new Error('头像读取失败，请重新选择'))
    });
  });
}

async function prepareAvatar(filePath) {
  if (!filePath) throw new Error('未选择头像');
  const compressedPath = await compressAvatar(filePath);
  const [type, base64] = await Promise.all([
    imageType(compressedPath),
    readBase64(compressedPath)
  ]);
  if (!['jpeg', 'png', 'webp'].includes(type)) {
    throw new Error('请选择 JPG、PNG 或 WebP 图片');
  }
  if (Math.floor(base64.length * 3 / 4) > MAX_AVATAR_BYTES) {
    throw new Error('头像文件过大，请重新选择');
  }
  return `data:image/${type};base64,${base64}`;
}

module.exports = { prepareAvatar };
