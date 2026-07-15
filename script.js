const revealElements = document.querySelectorAll(".reveal");
const initThreadsBackground = () => {
  const canvas = document.querySelector("#threads-background");
  if (!canvas) return;

  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    canvas.remove();
    return;
  }

  const vertexShaderSource = `
    attribute vec2 position;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;

    uniform float iTime;
    uniform vec3 iResolution;
    uniform vec3 uColor;
    uniform float uAmplitude;
    uniform float uDistance;
    uniform vec2 uMouse;

    #define PI 3.1415926538

    const int u_line_count = 40;
    const float u_line_width = 7.0;
    const float u_line_blur = 10.0;

    float Perlin2D(vec2 P) {
      vec2 Pi = floor(P);
      vec4 Pf_Pfmin1 = P.xyxy - vec4(Pi, Pi + 1.0);
      vec4 Pt = vec4(Pi.xy, Pi.xy + 1.0);
      Pt = Pt - floor(Pt * (1.0 / 71.0)) * 71.0;
      Pt += vec2(26.0, 161.0).xyxy;
      Pt *= Pt;
      Pt = Pt.xzxz * Pt.yyww;
      vec4 hash_x = fract(Pt * (1.0 / 951.135664));
      vec4 hash_y = fract(Pt * (1.0 / 642.949883));
      vec4 grad_x = hash_x - 0.49999;
      vec4 grad_y = hash_y - 0.49999;
      vec4 grad_results = inversesqrt(grad_x * grad_x + grad_y * grad_y)
        * (grad_x * Pf_Pfmin1.xzxz + grad_y * Pf_Pfmin1.yyww);
      grad_results *= 1.4142135623730950;
      vec2 blend = Pf_Pfmin1.xy * Pf_Pfmin1.xy * Pf_Pfmin1.xy
        * (Pf_Pfmin1.xy * (Pf_Pfmin1.xy * 6.0 - 15.0) + 10.0);
      vec4 blend2 = vec4(blend, vec2(1.0 - blend));
      return dot(grad_results, blend2.zxzx * blend2.wwyy);
    }

    float pixel(float count, vec2 resolution) {
      return (1.0 / max(resolution.x, resolution.y)) * count;
    }

    float lineFn(vec2 st, float width, float perc, vec2 mouse, float time, float amplitude, float distance) {
      float split_offset = perc * 0.4;
      float split_point = 0.1 + split_offset;
      float amplitude_normal = smoothstep(split_point, 0.7, st.x);
      float finalAmplitude = amplitude_normal * 0.5 * amplitude * (1.0 + (mouse.y - 0.5) * 0.2);
      float time_scaled = time / 10.0 + (mouse.x - 0.5) * 1.0;
      float blur = smoothstep(split_point, split_point + 0.05, st.x) * perc;

      float xnoise = mix(
        Perlin2D(vec2(time_scaled, st.x + perc) * 2.5),
        Perlin2D(vec2(time_scaled, st.x + time_scaled) * 3.5) / 1.5,
        st.x * 0.3
      );

      float y = 0.5 + (perc - 0.5) * distance + xnoise / 2.0 * finalAmplitude;
      float line_start = smoothstep(
        y + (width / 2.0) + (u_line_blur * pixel(1.0, iResolution.xy) * blur),
        y,
        st.y
      );
      float line_end = smoothstep(
        y,
        y - (width / 2.0) - (u_line_blur * pixel(1.0, iResolution.xy) * blur),
        st.y
      );

      return clamp(
        (line_start - line_end) * (1.0 - smoothstep(0.0, 1.0, pow(perc, 0.3))),
        0.0,
        1.0
      );
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / iResolution.xy;
      float line_strength = 1.0;

      for (int i = 0; i < u_line_count; i++) {
        float p = float(i) / float(u_line_count);
        line_strength *= (1.0 - lineFn(
          uv,
          u_line_width * pixel(1.0, iResolution.xy) * (1.0 - p),
          p,
          uMouse,
          iTime,
          uAmplitude,
          uDistance
        ));
      }

      float colorVal = 1.0 - line_strength;
      gl_FragColor = vec4(uColor * colorVal, colorVal);
    }
  `;

  const compileShader = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  if (!vertexShader || !fragmentShader) return;

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return;
  }

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 3, -1, -1, 3,
  ]), gl.STATIC_DRAW);

  const positionLocation = gl.getAttribLocation(program, "position");
  const uniforms = {
    iTime: gl.getUniformLocation(program, "iTime"),
    iResolution: gl.getUniformLocation(program, "iResolution"),
    uColor: gl.getUniformLocation(program, "uColor"),
    uAmplitude: gl.getUniformLocation(program, "uAmplitude"),
    uDistance: gl.getUniformLocation(program, "uDistance"),
    uMouse: gl.getUniformLocation(program, "uMouse"),
  };

  let currentMouse = [0.5, 0.5];
  let targetMouse = [0.5, 0.5];
  let frameId = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const handleMouseMove = (event) => {
    const rect = canvas.getBoundingClientRect();
    targetMouse = [
      (event.clientX - rect.left) / rect.width,
      1 - (event.clientY - rect.top) / rect.height,
    ];
  };

  const handleMouseLeave = () => {
    targetMouse = [0.5, 0.5];
  };

  const render = (time = 0) => {
    currentMouse[0] += 0.045 * (targetMouse[0] - currentMouse[0]);
    currentMouse[1] += 0.045 * (targetMouse[1] - currentMouse[1]);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(uniforms.iTime, time * 0.001);
    gl.uniform3f(uniforms.iResolution, canvas.width, canvas.height, canvas.width / canvas.height);
    gl.uniform3f(uniforms.uColor, 0.92, 0.92, 0.92);
    gl.uniform1f(uniforms.uAmplitude, 1.65);
    gl.uniform1f(uniforms.uDistance, 0.36);
    gl.uniform2f(uniforms.uMouse, currentMouse[0], currentMouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!reducedMotion) frameId = requestAnimationFrame(render);
  };

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseleave", handleMouseLeave);
  render(0);

  window.addEventListener("pagehide", () => {
    if (frameId) cancelAnimationFrame(frameId);
  }, { once: true });
};

initThreadsBackground();

const translations = {
  zh: {
    navWorks: "原创作品",
    navLive: "现场",
    navMedia: "媒体",
    navFootprints: "演出足迹",
    heroIdentity: "独立音乐人，声音实践者。",
    heroIntro: "以声音为介质，探索内在与世界的关系。",
    heroNoteA: "声音不是背景。",
    heroNoteB: "它是身体进入空间的方式。",
    brandDesc: "与 DIOR 合作声音创作与现场呈现，探索时尚与声音的共振可能。",
    contactLine: "For collaborations, performances, and sonic projects, please contact me.",
  },
  en: {
    navWorks: "Works",
    navLive: "Live",
    navMedia: "Media",
    navFootprints: "Footprints",
    heroIdentity: "Independent musician and sonic practitioner.",
    heroIntro: "Using sound as a medium to explore the relation between inner states and the world.",
    heroNoteA: "Sound is not background.",
    heroNoteB: "It is a way for the body to enter space.",
    brandDesc: "Sound creation and live presentation for DIOR, exploring resonance between fashion and sonic space.",
    contactLine: "For collaborations, performances, and sonic projects, please contact me.",
  },
};

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });

revealElements.forEach((element) => revealObserver.observe(element));

const languageToggle = document.querySelector("[data-lang-toggle]");
const translatableElements = document.querySelectorAll("[data-i18n]");
let activeLanguage = languageToggle ? localStorage.getItem("preferredLanguage") || "zh" : "zh";

const setLanguage = (language) => {
  activeLanguage = language;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.body.classList.toggle("lang-zh", language === "zh");
  document.body.classList.toggle("lang-en", language === "en");
  languageToggle?.setAttribute("aria-pressed", String(language === "en"));
  translatableElements.forEach((element) => {
    const value = translations[language][element.dataset.i18n];
    if (value) element.textContent = value;
  });
  if (languageToggle) localStorage.setItem("preferredLanguage", language);
};

languageToggle?.addEventListener("click", () => setLanguage(activeLanguage === "zh" ? "en" : "zh"));
setLanguage(activeLanguage);

const aboutCopy = document.querySelector(".about-panel .section-copy");
const updateAboutReveal = () => {
  if (!aboutCopy) return;
  const panel = aboutCopy.closest(".about-panel");
  const rect = panel.getBoundingClientRect();
  const start = window.innerHeight * 0.92;
  const end = window.innerHeight * 0.2;
  const progress = Math.max(0, Math.min(1, (start - rect.top) / (start - end)));
  aboutCopy.style.setProperty("--about-opacity", String(0.12 + progress * 0.88));
  aboutCopy.style.setProperty("--about-y", `${(1 - progress) * 46}px`);
  aboutCopy.style.setProperty("--about-blur", `${(1 - progress) * 8}px`);
};

window.addEventListener("scroll", updateAboutReveal, { passive: true });
window.addEventListener("resize", updateAboutReveal);
updateAboutReveal();

let activeTrackAudio = null;
let activeTrackControl = null;

const setSeekProgress = (seek, value) => {
  if (!seek) return;
  const progress = Math.max(0, Math.min(100, Number(value) || 0));
  seek.value = String(progress);
  seek.style.setProperty("--progress", `${progress}%`);
};

const setTrackButtonState = (control, isActive) => {
  if (!control) return;
  const playButton = control.querySelector(".track-play");
  const title = control.dataset.trackTitle || control.querySelector("strong")?.textContent.replace(/[《》]/g, "") || "作品";
  control.classList.toggle("is-active", isActive);
  control.setAttribute("aria-pressed", String(isActive));
  playButton?.setAttribute("aria-label", `${isActive ? "暂停" : "播放"} ${title}`);
};

document.querySelectorAll(".track-node").forEach((item) => {
  const control = item.querySelector(".track-orbital");
  const playButton = item.querySelector(".track-play");
  const audio = item.querySelector(".track-audio");
  const seek = item.querySelector(".track-seek");
  if (!control || !playButton || !audio || !seek) return;
  const originalAudioSrc = audio.currentSrc || new URL(audio.getAttribute("src"), window.location.href).href;
  let seekableSourcePromise = null;

  control.setAttribute("aria-pressed", "false");
  setSeekProgress(seek, 0);

  const ensureSeekableSource = () => {
    if (audio.dataset.seekableReady === "true") return Promise.resolve();
    if (!seekableSourcePromise) {
      seekableSourcePromise = fetch(originalAudioSrc)
        .then((response) => {
          if (!response.ok) throw new Error(`Audio load failed: ${response.status}`);
          return response.blob();
        })
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          audio.dataset.originalSrc = originalAudioSrc;
          audio.src = objectUrl;
          audio.dataset.seekableReady = "true";
          audio.load();
        })
        .catch((error) => {
          console.warn("Seekable audio preload failed", error);
        });
    }
    return seekableSourcePromise;
  };

  const updateProgress = () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      audio.progressFrame = requestAnimationFrame(updateProgress);
      return;
    }
    const progress = (audio.currentTime / audio.duration) * 100;
    setSeekProgress(seek, progress);
    if (!audio.paused && !audio.ended) audio.progressFrame = requestAnimationFrame(updateProgress);
  };

  const stopProgressLoop = () => {
    if (audio.progressFrame) cancelAnimationFrame(audio.progressFrame);
    audio.progressFrame = null;
  };

  const pauseTrack = () => {
    stopProgressLoop();
    audio.pause();
    setTrackButtonState(control, false);
    if (activeTrackAudio === audio) {
      activeTrackAudio = null;
      activeTrackControl = null;
    }
  };

  const playTrack = async () => {
    if (activeTrackAudio === audio && !audio.paused) {
      pauseTrack();
      return;
    }

    if (activeTrackAudio && activeTrackAudio !== audio) {
      activeTrackAudio.pause();
      if (activeTrackAudio.progressFrame) cancelAnimationFrame(activeTrackAudio.progressFrame);
      setTrackButtonState(activeTrackControl, false);
    }

    try {
      activeTrackAudio = audio;
      activeTrackControl = control;
      audio.muted = false;
      audio.volume = 1;
      await ensureSeekableSource();
      if (audio.readyState === 0) audio.load();
      await audio.play();
      setTrackButtonState(control, true);
      stopProgressLoop();
      updateProgress();
    } catch (error) {
      console.warn("Audio playback failed", error);
      setTrackButtonState(control, false);
      if (activeTrackAudio === audio) activeTrackAudio = null;
      if (activeTrackControl === control) activeTrackControl = null;
    }
  };

  control.addEventListener("click", (event) => {
    if (event.target.closest(".track-progress")) return;
    playTrack();
  });

  playButton.addEventListener("click", (event) => {
    event.stopPropagation();
    playTrack();
  });

  const applySeek = () => {
    const progress = Number(seek.value);
    setSeekProgress(seek, progress);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (progress / 100) * audio.duration;
    }
  };

  seek.addEventListener("input", () => {
    applySeek();
  });

  seek.addEventListener("change", () => {
    applySeek();
  });

  audio.addEventListener("loadedmetadata", () => {
    setSeekProgress(seek, Number.isFinite(audio.duration) && audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0);
  });

  audio.addEventListener("play", () => {
    activeTrackAudio = audio;
    activeTrackControl = control;
    setTrackButtonState(control, true);
    stopProgressLoop();
    updateProgress();
  });

  audio.addEventListener("pause", () => {
    stopProgressLoop();
    setTrackButtonState(control, false);
  });

  audio.addEventListener("ended", () => {
    stopProgressLoop();
    audio.currentTime = 0;
    setSeekProgress(seek, 0);
    setTrackButtonState(control, false);
    if (activeTrackAudio === audio) {
      activeTrackAudio = null;
      activeTrackControl = null;
    }
  });

  ensureSeekableSource();
});

const videoCards = document.querySelectorAll(".video-card");
const activateVideoCard = (card) => {
  if (!card) return;
  videoCards.forEach((item) => item.classList.toggle("is-active", item === card));
};

videoCards.forEach((card) => {
  const video = card.querySelector(".video-window");
  const thumb = card.querySelector(".video-thumb");
  const frame = card.querySelector(".video-frame");

  const prepareVideo = () => {
    if (!video || video.currentSrc || !video.dataset.src) return;
    const source = document.createElement("source");
    source.src = video.dataset.src;
    source.type = "video/mp4";
    video.append(source);
    video.removeAttribute("data-src");
    video.load();
  };

  card.addEventListener("pointerdown", () => activateVideoCard(card));
  thumb?.addEventListener("click", async () => {
    activateVideoCard(card);
    prepareVideo();
    frame?.classList.add("is-playing");
    try {
      await video?.play();
    } catch (error) {
      console.warn("Video playback failed", error);
    }
  });
  video?.addEventListener("play", () => {
    videoCards.forEach((item) => {
      if (item !== card) item.querySelector(".video-window")?.pause();
    });
    frame?.classList.add("is-playing");
    activateVideoCard(card);
  });
  video?.addEventListener("focus", () => activateVideoCard(card));
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});
