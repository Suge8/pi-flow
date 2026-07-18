// 把浅底 logo 图抠成透明底、统一近黑色后绘制到 .brand canvas。
// 需要 Chrome 带 --allow-file-access-from-files 才能在 file:// 下 getImageData。
const logoImage = new Image();
logoImage.onload = () => {
	const canvas = document.querySelector("canvas.logo");
	canvas.width = logoImage.width;
	canvas.height = logoImage.height;
	const ctx = canvas.getContext("2d");
	ctx.drawImage(logoImage, 0, 0);
	const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const px = frame.data;
	for (let i = 0; i < px.length; i += 4) {
		const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
		const alpha = Math.max(
			0,
			Math.min(255, Math.round(((240 - lum) * 255) / 100)),
		);
		px[i + 3] = Math.min(px[i + 3], alpha);
		px[i] = 28;
		px[i + 1] = 25;
		px[i + 2] = 23;
	}
	ctx.putImageData(frame, 0, 0);
};
logoImage.src = "../visual/logo-final.png";
