(() => {
  "use strict";

  const OUTPUT_WIDTH = 1152;
  const OUTPUT_HEIGHT = 2048;

  const els = {
    booth: document.querySelector("#booth"),
    video: document.querySelector("#cameraVideo"),
    cameraStage: document.querySelector("#cameraStage"),
    cameraStatus: document.querySelector("#cameraStatus"),
    switchButton: document.querySelector("#cameraSwitchButton"),
    captureButton: document.querySelector("#captureButton"),
    frame: document.querySelector("#frameOverlay"),
    resultImage: document.querySelector("#resultImage"),
    liveControls: document.querySelector("#liveControls"),
    resultControls: document.querySelector("#resultControls"),
    permissionPanel: document.querySelector("#permissionPanel"),
    permissionMessage: document.querySelector("#permissionMessage"),
    retryButton: document.querySelector("#retryButton"),
    retakeButton: document.querySelector("#retakeButton"),
    downloadButton: document.querySelector("#downloadButton"),
    canvas: document.querySelector("#captureCanvas"),
  };

  const state = {
    stream: null,
    facingMode: "user",
    frameImage: null,
    resultBlob: null,
    resultUrl: "",
    starting: false,
  };

  function setStatus(message, visible = true) {
    els.cameraStatus.textContent = message;
    els.cameraStatus.hidden = !visible;
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }

    els.video.srcObject = null;
    els.captureButton.disabled = true;
  }

  function cameraErrorMessage(error) {
    switch (error?.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "相機權限未開啟。請到瀏覽器的網站設定允許使用相機，再按 TRY AGAIN。";
      case "NotFoundError":
      case "OverconstrainedError":
        return "找不到可使用的相機，請確認裝置相機功能後再試一次。";
      case "NotReadableError":
      case "AbortError":
        return "相機可能正被其他 App 使用，關閉其他相機／視訊 App 後再試一次。";
      default:
        return "無法啟用相機。請使用 HTTPS 網址，並以 Safari 或 Chrome 開啟。";
    }
  }

  async function getStream(facingMode) {
    const preferred = {
      audio: false,
      video: {
        facingMode: { exact: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1920 },
      },
    };

    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (error) {
      if (
        error?.name !== "OverconstrainedError" &&
        error?.name !== "NotFoundError"
      ) {
        throw error;
      }

      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1920 },
        },
      });
    }
  }

  async function startCamera() {
    if (state.starting) return;

    state.starting = true;
    els.permissionPanel.hidden = true;
    els.liveControls.hidden = false;
    els.resultControls.hidden = true;
    els.resultImage.hidden = true;
    els.video.hidden = false;
    els.frame.hidden = false;
    els.switchButton.disabled = false;
    els.captureButton.disabled = true;

    setStatus("REQUESTING CAMERA…", true);

    if (!navigator.mediaDevices?.getUserMedia) {
      const message =
        "此瀏覽器無法啟用相機。請使用手機 Safari 或 Chrome，並確認網址為 HTTPS。";
      els.permissionMessage.textContent = message;
      els.permissionPanel.hidden = false;
      setStatus("CAMERA UNAVAILABLE", true);
      state.starting = false;
      return;
    }

    stopCamera();

    try {
      state.stream = await getStream(state.facingMode);

      const track = state.stream.getVideoTracks()[0];
      const actualFacing = track?.getSettings?.().facingMode;

      if (actualFacing === "user" || actualFacing === "environment") {
        state.facingMode = actualFacing;
      }

      els.video.srcObject = state.stream;

      await new Promise((resolve) => {
        if (els.video.readyState >= 2) {
          resolve();
          return;
        }

        els.video.addEventListener("loadedmetadata", resolve, { once: true });
      });

      await els.video.play();

      els.cameraStage.classList.toggle(
        "is-environment",
        state.facingMode === "environment",
      );

      setStatus("", false);
      els.captureButton.disabled = false;
    } catch (error) {
      console.error(error);
      const message = cameraErrorMessage(error);
      els.permissionMessage.textContent = message;
      els.permissionPanel.hidden = false;
      els.liveControls.hidden = true;
      setStatus("CAMERA PERMISSION REQUIRED", true);
    } finally {
      state.starting = false;
    }
  }

  function loadFrame() {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        state.frameImage = image;
        resolve();
      };

      image.onerror = () => reject(new Error("Frame failed to load."));
      image.src = "./assets/rasa-frame.png";
    });
  }

  function drawCover(ctx, video, width, height, mirror) {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;

    if (!sourceWidth || !sourceHeight) {
      throw new Error("Camera is not ready.");
    }

    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = width / height;

    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }

    ctx.save();

    if (mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(
      video,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      width,
      height,
    );

    ctx.restore();
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Unable to export photo."));
        },
        "image/jpeg",
        0.95,
      );
    });
  }

  function filename() {
    const now = new Date();
    const pad = (number) => String(number).padStart(2, "0");

    return [
      "RASA_PHOTO_BOOTH_",
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "_",
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
      ".jpg",
    ].join("");
  }

  function clearResultUrl() {
    if (state.resultUrl) {
      URL.revokeObjectURL(state.resultUrl);
      state.resultUrl = "";
    }
  }

  async function capture() {
    if (!state.stream || els.captureButton.disabled) return;

    els.captureButton.disabled = true;

    els.cameraStage.classList.remove("is-flashing");
    void els.cameraStage.offsetWidth;
    els.cameraStage.classList.add("is-flashing");

    try {
      const canvas = els.canvas;
      const ctx = canvas.getContext("2d", { alpha: false });

      canvas.width = OUTPUT_WIDTH;
      canvas.height = OUTPUT_HEIGHT;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

      drawCover(
        ctx,
        els.video,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
        state.facingMode === "user",
      );

      ctx.drawImage(
        state.frameImage,
        0,
        0,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
      );

      state.resultBlob = await canvasToBlob(canvas);

      clearResultUrl();
      state.resultUrl = URL.createObjectURL(state.resultBlob);

      els.resultImage.src = state.resultUrl;
      els.resultImage.hidden = false;
      els.video.hidden = true;
      els.frame.hidden = true;

      els.liveControls.hidden = true;
      els.resultControls.hidden = false;
      els.permissionPanel.hidden = true;
      els.switchButton.disabled = true;

      stopCamera();
    } catch (error) {
      console.error(error);
      els.captureButton.disabled = false;
      window.alert("照片處理失敗，請重新拍攝。");
    }
  }

  async function switchCamera() {
    if (state.starting) return;
    state.facingMode =
      state.facingMode === "user" ? "environment" : "user";
    await startCamera();
  }

  async function retake() {
    els.resultImage.hidden = true;
    els.video.hidden = false;
    els.frame.hidden = false;
    els.resultControls.hidden = true;
    els.liveControls.hidden = false;
    els.switchButton.disabled = false;
    await startCamera();
  }

  async function downloadPhoto() {
    if (!state.resultBlob) return;

    const name = filename();
    const file = new File([state.resultBlob], name, {
      type: state.resultBlob.type,
    });

    /*
      On iPhone/Safari, Web Share with a file is usually the most reliable
      route to "Save Image". Other browsers fall back to a normal download.
    */
    if (
      navigator.share &&
      navigator.canShare &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: "RASA PHOTO BOOTH",
        });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.error(error);
      }
    }

    const link = document.createElement("a");
    link.href = state.resultUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function init() {
    try {
      await loadFrame();
    } catch (error) {
      console.error(error);
      setStatus("FRAME LOAD ERROR", true);
      return;
    }

    els.switchButton.addEventListener("click", switchCamera);
    els.captureButton.addEventListener("click", capture);
    els.retakeButton.addEventListener("click", retake);
    els.downloadButton.addEventListener("click", downloadPhoto);
    els.retryButton.addEventListener("click", startCamera);

    /*
      No landing page: request camera permission immediately after opening.
    */
    await startCamera();
  }

  window.addEventListener("pagehide", () => {
    stopCamera();
    clearResultUrl();
  });

  init();
})();
