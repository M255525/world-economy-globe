/* 世界經濟 3D 地圖 — 場景（window.GlobeScene）
 * 地球與平面地圖共用同一張 PlaneGeometry，在 vertex shader 依 uMorph 在球面／平面之間變形；
 * 國家上色畫在 2D canvas（等距圓柱投影）當貼圖；長條、弧線、標籤在 CPU 端用 posAt() 跟著變形。
 */
(function () {
  'use strict';
  var S = window.GlobeScene = {};
  var D2R = Math.PI / 180, R = 10, MAXH = 6;

  var T, Orbit, renderer, scene, camera, controls, clock, raycaster;
  var host, labelRoot;
  var globe, globeMat, atmo, atmoMat, stars, texCanvas, texCtx, texture;
  var barGroup, bars = {}, barMeshes = [], ring;
  var arcGroup, arcs = [], particles, particleGeo;
  var features = [];
  var labelList = [], labelEls = {};
  var handlers = {};
  var morph = 0, morphAnim = null, view = 'globe';
  var fly = null, selected = null, inset = { right: 0, bottom: 0 };
  var opts = { autoRotate: true, rotateSpeed: 0.6, reduce: false, arcs: true, heightScale: 1, dark: false };
  var tmpV, tmpN, UP, W = 1, H = 1, lastInteract = 0;

  S.ready = false;
  S.on = function (ev, fn) { handlers[ev] = fn; };
  function emit(ev, a, b) { if (handlers[ev]) handlers[ev](a, b); }

  /* ---------- 投影：m=0 球面、m=1 平面 ---------- */
  function posAt(lon, lat, h, m, out) {
    var la = lat * D2R, lo = lon * D2R, r = R + h;
    var sx = r * Math.cos(la) * Math.sin(lo), sy = r * Math.sin(la), sz = r * Math.cos(la) * Math.cos(lo);
    var fx = lo * R, fy = la * R, fz = h;
    return out.set(sx + (fx - sx) * m, sy + (fy - sy) * m, sz + (fz - sz) * m);
  }
  function normalAt(lon, lat, m, out) {
    var la = lat * D2R, lo = lon * D2R;
    out.set(Math.cos(la) * Math.sin(lo) * (1 - m), Math.sin(la) * (1 - m), Math.cos(la) * Math.cos(lo) * (1 - m) + m);
    if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
    return out.normalize();
  }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* ---------- 國界資料 ---------- */
  function loadWorld() {
    function decode(topo) {
      var fc = window.topojson.feature(topo, topo.objects.countries);
      features = fc.features.map(function (f) {
        var polys = f.geometry ? (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) : [];
        var minX = 999, minY = 999, maxX = -999, maxY = -999;
        polys.forEach(function (p) { p.forEach(function (ring) { ring.forEach(function (pt) {
          if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1];
        }); }); });
        return { num: f.id, name: f.properties && f.properties.name, polys: polys, bbox: [minX, minY, maxX, maxY] };
      });
      return features;
    }
    return fetch('vendor/countries-110m.json')
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function () { return fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then(function (r) { return r.json(); }); })
      .then(decode);
  }
  function inRing(ring, x, y) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  S.countryAt = function (lon, lat) {
    for (var k = 0; k < features.length; k++) {
      var f = features[k], b = f.bbox;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      for (var p = 0; p < f.polys.length; p++) {
        var inside = false;
        f.polys[p].forEach(function (ring) { if (inRing(ring, lon, lat)) inside = !inside; });
        if (inside) return f;
      }
    }
    return null;
  };
  S.features = function () { return features; };

  /* ---------- 貼圖 ---------- */
  S.paint = function (colorOf, cfg) {
    if (!texCtx) return;
    var w = texCanvas.width, h = texCanvas.height, ctx = texCtx;
    function X(lon) { return (lon + 180) / 360 * w; }
    function Y(lat) { return (90 - lat) / 180 * h; }
    ctx.globalAlpha = 1;
    ctx.fillStyle = cfg.ocean; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = cfg.grid; ctx.lineWidth = w / 2048;
    ctx.beginPath();
    for (var lo = -180; lo <= 180; lo += 30) { ctx.moveTo(X(lo), 0); ctx.lineTo(X(lo), h); }
    for (var la = -60; la <= 60; la += 30) { ctx.moveTo(0, Y(la)); ctx.lineTo(w, Y(la)); }
    ctx.stroke();
    /* 跨 180° 經線的環（俄羅斯、斐濟）先展開成連續經度，再在 ±360° 各畫一份；南極洲環繞極點，照原樣畫 */
    function path(f) {
      ctx.beginPath();
      var polar = f.bbox[1] < -80;
      f.polys.forEach(function (p) { p.forEach(function (ring) {
        var pts = [], off = 0, wrap = false;
        ring.forEach(function (pt, i) {
          if (i && !polar) {
            var d = pt[0] + off - pts[i - 1][0];
            if (d > 180) { off -= 360; wrap = true; } else if (d < -180) { off += 360; wrap = true; }
          }
          pts.push([pt[0] + (polar ? 0 : off), pt[1]]);
        });
        (wrap ? [-360, 0, 360] : [0]).forEach(function (s) {
          pts.forEach(function (pt, i) { if (i) ctx.lineTo(X(pt[0] + s), Y(pt[1])); else ctx.moveTo(X(pt[0] + s), Y(pt[1])); });
          ctx.closePath();
        });
      }); });
    }
    features.forEach(function (f) {
      var c = colorOf(f);
      path(f);
      ctx.globalAlpha = c.alpha == null ? 1 : c.alpha;
      ctx.fillStyle = c.fill; ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cfg.border; ctx.lineWidth = w / 1600; ctx.stroke();
    });
    if (cfg.selected) {
      features.forEach(function (f) {
        if (f.num !== cfg.selected) return;
        path(f); ctx.strokeStyle = cfg.selColor; ctx.lineWidth = w / 380; ctx.stroke();
      });
    }
    texture.needsUpdate = true;
  };

  /* ---------- 地球 ---------- */
  function buildGlobe() {
    var big = Math.min(innerWidth, innerHeight) > 700;
    texCanvas = document.createElement('canvas');
    texCanvas.width = big ? 4096 : 2048; texCanvas.height = texCanvas.width / 2;
    texCtx = texCanvas.getContext('2d');
    texture = new T.CanvasTexture(texCanvas);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    var geo = new T.PlaneGeometry(2 * Math.PI * R, Math.PI * R, 192, 96);
    globeMat = new T.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uMorph: { value: 0 }, uLight: { value: new T.Vector3(1, 1, 1) }, uR: { value: R } },
      side: T.DoubleSide,
      vertexShader: [
        'uniform float uMorph; uniform float uR;',
        'varying vec2 vUv; varying vec3 vN; varying vec3 vW;',
        'void main(){',
        '  vUv = uv;',
        '  float lo = position.x / uR; float la = position.y / uR;',
        '  vec3 sp = uR * vec3(cos(la)*sin(lo), sin(la), cos(la)*cos(lo));',
        '  vec3 p = mix(sp, vec3(position.xy, 0.0), uMorph);',
        '  vec3 n = mix(normalize(sp), vec3(0.0, 0.0, 1.0), uMorph);',
        '  n = length(n) < 0.001 ? vec3(0.0, 0.0, 1.0) : normalize(n);',
        '  vN = normalize(mat3(modelMatrix) * n);',
        '  vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * w;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap; uniform float uMorph; uniform vec3 uLight;',
        'varying vec2 vUv; varying vec3 vN; varying vec3 vW;',
        'void main(){',
        '  vec3 c = texture2D(uMap, vUv).rgb;',
        '  vec3 N = normalize(vN);',
        '  float d = max(dot(N, normalize(uLight)), 0.0);',
        '  float lit = mix(0.62 + 0.48 * d, 1.0, uMorph);',
        '  vec3 V = normalize(cameraPosition - vW);',
        '  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * (1.0 - uMorph);',
        '  gl_FragColor = vec4(c * lit + rim * vec3(0.35, 0.62, 1.0) * 0.55, 1.0);',
        '}'
      ].join('\n')
    });
    globe = new T.Mesh(geo, globeMat);
    globe.renderOrder = 0;
    scene.add(globe);

    atmoMat = new T.ShaderMaterial({
      uniforms: { uFade: { value: 1 }, uColor: { value: new T.Color('#6fb8ff') } },
      side: T.BackSide, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uFade; uniform vec3 uColor; varying vec3 vN; varying vec3 vP; void main(){ float i = pow(max(0.0, 0.62 - dot(vN, normalize(-vP))), 2.5); gl_FragColor = vec4(uColor, clamp(i, 0.0, 1.0) * 0.55 * uFade); }'
    });
    atmo = new T.Mesh(new T.SphereGeometry(R * 1.1, 64, 32), atmoMat);
    scene.add(atmo);

    var sp = [], n = 1400;
    for (var i = 0; i < n; i++) {
      var u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, rr = 180 + Math.random() * 60, s = Math.sqrt(1 - u * u);
      sp.push(rr * s * Math.cos(a), rr * u, rr * s * Math.sin(a));
    }
    var sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: true, transparent: true, opacity: .8, depthWrite: false }));
    scene.add(stars);
  }

  /* ---------- 長條 ---------- */
  var barGeo;
  S.setBars = function (list) {
    if (!S.ready) return;
    var keep = {};
    list.forEach(function (it) {
      keep[it.iso] = 1;
      var b = bars[it.iso];
      if (!b) {
        var mat = new T.MeshLambertMaterial({ color: it.color, emissive: 0x000000, transparent: true, opacity: 1 });
        var mesh = new T.Mesh(barGeo, mat);
        mesh.userData.iso = it.iso;
        barGroup.add(mesh); barMeshes.push(mesh);
        b = bars[it.iso] = { mesh: mesh, h: 0 };
      }
      b.lon = it.lon; b.lat = it.lat; b.ht = Math.max(it.h, 0.012); b.dim = !!it.dim;
      b.mesh.material.color.set(it.color);
      b.mesh.material.opacity = it.dim ? 0.18 : 1;
      b.mesh.visible = true;
      if (opts.reduce) b.h = b.ht;
    });
    Object.keys(bars).forEach(function (k) { if (!keep[k]) bars[k].mesh.visible = false; });
  };
  function updateBars(dt) {
    var k = Math.min(1, dt * 5);
    Object.keys(bars).forEach(function (iso) {
      var b = bars[iso];
      if (!b.mesh.visible) return;
      b.h += (b.ht - b.h) * (opts.reduce ? 1 : k);
      var hh = b.h * MAXH * opts.heightScale;
      posAt(b.lon, b.lat, 0.03, morph, b.mesh.position);
      normalAt(b.lon, b.lat, morph, tmpN);
      b.mesh.quaternion.setFromUnitVectors(UP, tmpN);
      var wdt = iso === selected ? 0.36 : 0.24;
      b.mesh.scale.set(wdt, Math.max(hh, 0.02), wdt);
      b.mesh.material.emissive.setHex(iso === selected ? 0x553300 : 0x000000);
      b.top = b.top || new T.Vector3();
      posAt(b.lon, b.lat, 0.03 + Math.max(hh, 0.02), morph, b.top);
    });
    if (selected && bars[selected] && bars[selected].mesh.visible) {
      var sb = bars[selected];
      ring.visible = true;
      posAt(sb.lon, sb.lat, 0.04, morph, ring.position);
      normalAt(sb.lon, sb.lat, morph, tmpN);
      ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), tmpN);
      var pulse = opts.reduce ? 1 : 1 + 0.25 * Math.sin(clock.elapsedTime * 4);
      ring.scale.setScalar(pulse);
    } else ring.visible = false;
  }

  /* ---------- 貿易弧線 ---------- */
  var ARC_N = 64, PER_ARC = 3;
  S.setArcs = function (list) {
    if (!S.ready) return;
    arcs.forEach(function (a) { arcGroup.remove(a.line); a.line.geometry.dispose(); });
    arcs = [];
    list.forEach(function (it) {
      var va = new T.Vector3(), vb = new T.Vector3();
      normalAt(it.a.lon, it.a.lat, 0, va); normalAt(it.b.lon, it.b.lat, 0, vb);
      var om = Math.acos(Math.max(-1, Math.min(1, va.dot(vb))));
      var lift = Math.min(4.5, 0.6 + om * 2.6);
      var G = [], F = [];
      for (var i = 0; i <= ARC_N; i++) {
        var t = i / ARC_N, s = Math.sin(om) || 1e-6;
        var p = va.clone().multiplyScalar(Math.sin((1 - t) * om) / s).add(vb.clone().multiplyScalar(Math.sin(t * om) / s));
        var bump = Math.sin(Math.PI * t) * lift;
        G.push(p.normalize().multiplyScalar(R + 0.05 + bump));
        var lo = (it.a.lon + (it.b.lon - it.a.lon) * t) * D2R, la = (it.a.lat + (it.b.lat - it.a.lat) * t) * D2R;
        F.push(new T.Vector3(lo * R, la * R, 0.05 + bump * 0.55));
      }
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array((ARC_N + 1) * 3), 3));
      var line = new T.Line(geo, new T.LineBasicMaterial({ color: it.color || 0xffb703, transparent: true, opacity: it.strong ? 0.95 : 0.6, depthWrite: false }));
      line.renderOrder = 2;
      arcGroup.add(line);
      arcs.push({ line: line, G: G, F: F, pts: [], off: Math.random() });
    });
    var total = Math.max(1, arcs.length * PER_ARC);
    particleGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(total * 3), 3));
    particleGeo.setDrawRange(0, arcs.length * PER_ARC);
    arcGroup.visible = opts.arcs;
    updateArcs(0, true);
  };
  var arcMorphSeen = -1;
  function updateArcs(dt, force) {
    if (!arcs.length) return;
    if (force || arcMorphSeen !== morph) {
      arcMorphSeen = morph;
      arcs.forEach(function (a) {
        var pos = a.line.geometry.attributes.position;
        for (var i = 0; i <= ARC_N; i++) {
          var g = a.G[i], f = a.F[i];
          var x = g.x + (f.x - g.x) * morph, y = g.y + (f.y - g.y) * morph, z = g.z + (f.z - g.z) * morph;
          pos.setXYZ(i, x, y, z);
          a.pts[i] = a.pts[i] || new T.Vector3();
          a.pts[i].set(x, y, z);
        }
        pos.needsUpdate = true;
        a.line.geometry.computeBoundingSphere();
      });
    }
    var pp = particleGeo.attributes.position, t0 = clock.elapsedTime * 0.25, idx = 0;
    arcs.forEach(function (a) {
      for (var k = 0; k < PER_ARC; k++) {
        var t = opts.reduce ? (k + 0.5) / PER_ARC : (t0 + a.off + k / PER_ARC) % 1;
        var fi = t * ARC_N, i0 = Math.floor(fi), i1 = Math.min(ARC_N, i0 + 1), fr = fi - i0;
        var p0 = a.pts[i0], p1 = a.pts[i1];
        pp.setXYZ(idx++, p0.x + (p1.x - p0.x) * fr, p0.y + (p1.y - p0.y) * fr, p0.z + (p1.z - p0.z) * fr);
      }
    });
    pp.needsUpdate = true;
  }

  /* ---------- 標籤（HTML 疊層，依優先序避讓） ---------- */
  S.setLabels = function (list) {
    if (!S.ready) return;
    labelList = list;
    var keep = {};
    list.forEach(function (it) {
      keep[it.iso] = 1;
      var el = labelEls[it.iso];
      if (!el) {
        el = labelEls[it.iso] = document.createElement('button');
        el.type = 'button'; el.className = 'glabel';
        el.addEventListener('click', function () { emit('pick', { iso: it.iso }); });
        labelRoot.appendChild(el);
      }
      var sig = it.text + '|' + (it.sub || '');
      if (el._sig !== sig) {
        el._sig = sig; el._w = 0;
        el.innerHTML = '<b></b><span></span>';
        el.firstChild.textContent = it.text; el.lastChild.textContent = it.sub || '';
      }
      el.classList.toggle('tw', it.iso === 'TWN');
      el.classList.toggle('sel', it.iso === selected);
    });
    Object.keys(labelEls).forEach(function (k) { if (!keep[k]) { labelEls[k].remove(); delete labelEls[k]; } });
  };
  function updateLabels() {
    var placed = [], camPos = camera.position;
    var sorted = labelList.slice().sort(function (a, b) { return (b.iso === selected) - (a.iso === selected) || b.pri - a.pri; });
    sorted.forEach(function (it) {
      var el = labelEls[it.iso], b = bars[it.iso];
      if (!el) return;
      if (!b || !b.top || !b.mesh.visible) { el.style.display = 'none'; return; }
      normalAt(b.lon, b.lat, morph, tmpN);
      tmpV.copy(camPos).sub(b.top);
      if (tmpN.dot(tmpV) < 0) { el.style.display = 'none'; return; }
      tmpV.copy(b.top).project(camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) { el.style.display = 'none'; return; }
      var x = (tmpV.x + 1) / 2 * W, y = (1 - tmpV.y) / 2 * H;
      var w = el._w || 70, h = el._h || 30;
      var rect = [x - w / 2, y - h - 6, x + w / 2, y - 6];
      var hit = placed.some(function (r) { return !(rect[2] < r[0] || rect[0] > r[2] || rect[3] < r[1] || rect[1] > r[3]); });
      if (hit && it.iso !== selected) { el.style.display = 'none'; return; }
      placed.push(rect);
      el.style.display = '';
      el.style.transform = 'translate(' + Math.round(rect[0]) + 'px,' + Math.round(rect[1]) + 'px)';
      if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
    });
  }

  /* ---------- 相機 ---------- */
  function flatDist() {
    var aspect = W / H, fit = (2 * Math.PI * R * 1.04) / (aspect * 2 * Math.tan(21 * D2R));
    var fitH = (Math.PI * R * 1.1) / (2 * Math.tan(21 * D2R));
    return Math.max(18, Math.min(120, Math.max(Math.min(fit, fitH * 1.6), fitH * 0.7)));
  }
  function applyConstraints() {
    if (view === 'flat') {
      controls.minDistance = 8; controls.maxDistance = 130;
      controls.minPolarAngle = Math.PI / 2 - 0.05; controls.maxPolarAngle = Math.PI / 2 + 0.75;
      controls.minAzimuthAngle = -0.6; controls.maxAzimuthAngle = 0.6;
      controls.screenSpacePanning = true; controls.enablePan = true;
    } else {
      controls.minDistance = 12.5; controls.maxDistance = 70;
      controls.minPolarAngle = 0.15; controls.maxPolarAngle = Math.PI - 0.15;
      controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
      controls.enablePan = false;
    }
  }
  function startFly(toPos, toTarget, dur, globeArc) {
    fly = { t: 0, dur: opts.reduce ? 0.001 : dur, fp: camera.position.clone(), ft: controls.target.clone(), tp: toPos, tt: toTarget, arc: globeArc };
  }
  function stepFly(dt) {
    if (!fly) return;
    fly.t = Math.min(1, fly.t + dt / fly.dur);
    var e = ease(fly.t);
    if (fly.arc) {
      var d0 = fly.fp.length(), d1 = fly.tp.length();
      var a = fly.fp.clone().normalize(), b = fly.tp.clone().normalize();
      var q = new T.Quaternion().setFromUnitVectors(a, b), q0 = new T.Quaternion();
      q0.slerp(q, e);
      camera.position.copy(a.applyQuaternion(q0).multiplyScalar(d0 + (d1 - d0) * e));
    } else camera.position.lerpVectors(fly.fp, fly.tp, e);
    controls.target.lerpVectors(fly.ft, fly.tt, e);
    if (fly.t >= 1) fly = null;
  }
  S.flyTo = function (lon, lat, close) {
    if (!S.ready) return;
    lastInteract = performance.now();
    if (view === 'flat') {
      var t = new T.Vector3(lon * D2R * R, lat * D2R * R, 0);
      startFly(t.clone().add(new T.Vector3(0, -9, close ? 26 : 34)), t, 1.2, false);
    } else {
      var dist = close ? (W < 600 ? 36 : 28) : Math.max(30, Math.min(38, camera.position.length()));
      normalAt(lon, lat, 0, tmpN);
      var p = tmpN.clone().multiplyScalar(dist);
      p.y += 2.5;
      startFly(p.setLength(dist), new T.Vector3(0, 0, 0), 1.4, true);
    }
  };
  S.setView = function (v, focus) {
    if (!S.ready || v === view) return;
    view = v;
    var from = morph, to = v === 'flat' ? 1 : 0;
    morphAnim = { t: 0, from: from, to: to, dur: opts.reduce ? 0.001 : 1.4 };
    applyConstraints();
    if (v === 'flat') {
      var fx = focus ? focus.lon * D2R * R * 0.35 : 0, fy = focus ? focus.lat * D2R * R * 0.2 : 0;
      startFly(new T.Vector3(fx, fy - 10, flatDist()), new T.Vector3(fx, fy, 0), 1.4, false);
    } else {
      var lon = focus ? focus.lon : 121, lat = focus ? focus.lat : 20;
      normalAt(lon, lat, 0, tmpN);
      startFly(tmpN.clone().multiplyScalar(36), new T.Vector3(0, 0, 0), 1.4, false);
    }
  };
  S.getView = function () { return view; };
  S.resetCamera = function () {
    if (view === 'flat') startFly(new T.Vector3(0, -10, flatDist()), new T.Vector3(0, 0, 0), 1, false);
    else { normalAt(121, 20, 0, tmpN); startFly(tmpN.clone().multiplyScalar(36), new T.Vector3(0, 0, 0), 1.2, true); }
  };
  S.setSelected = function (iso) {
    selected = iso;
    Object.keys(labelEls).forEach(function (k) { labelEls[k].classList.toggle('sel', k === iso); });
  };
  S.setOpts = function (o) {
    Object.keys(o).forEach(function (k) { opts[k] = o[k]; });
    if (!S.ready) return;
    arcGroup.visible = opts.arcs;
    stars.material.opacity = opts.dark ? 0.85 : 0.0;
    atmoMat.uniforms.uColor.value.set(opts.dark ? '#5aa9ff' : '#8fd0ff');
  };
  S.setInset = function (r, b) { inset.right = r || 0; inset.bottom = b || 0; resize(); };

  /* ---------- 點選 ---------- */
  function pickAt(cx, cy) {
    var rect = renderer.domElement.getBoundingClientRect();
    var ndc = new T.Vector2((cx - rect.left) / rect.width * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObjects(barMeshes.filter(function (m) { return m.visible && m.material.opacity > 0.5; }), false);
    if (hits.length) return { iso: hits[0].object.userData.iso };
    var p = new T.Vector3(), ok = null, lon, lat;
    if (morph < 0.02) {
      ok = raycaster.ray.intersectSphere(new T.Sphere(new T.Vector3(), R), p);
      if (ok) { lon = Math.atan2(p.x, p.z) / D2R; lat = Math.asin(Math.max(-1, Math.min(1, p.y / R))) / D2R; }
    } else if (morph > 0.98) {
      ok = raycaster.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), 0), p);
      if (ok) { lon = p.x / R / D2R; lat = p.y / R / D2R; if (Math.abs(lon) > 180 || Math.abs(lat) > 90) ok = null; }
    }
    if (!ok) return null;
    var f = S.countryAt(lon, lat);
    return { lon: lon, lat: lat, num: f ? f.num : null, name: f ? f.name : null };
  }
  function bindPointer() {
    var el = renderer.domElement, down = null, hoverReq = null, hoverEv = null;
    el.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; lastInteract = performance.now(); fly = null; });
    el.addEventListener('pointerup', function (e) {
      if (!down) return;
      var moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved < 6) emit('pick', pickAt(e.clientX, e.clientY));
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      hoverEv = e;
      if (hoverReq) return;
      hoverReq = requestAnimationFrame(function () {
        hoverReq = null;
        if (!hoverEv || down) return;
        emit('hover', pickAt(hoverEv.clientX, hoverEv.clientY), { x: hoverEv.clientX, y: hoverEv.clientY });
      });
    });
    el.addEventListener('pointerleave', function () { emit('hover', null); });
    el.addEventListener('wheel', function () { lastInteract = performance.now(); }, { passive: true });
  }

  /* ---------- 迴圈 ---------- */
  function resize() {
    W = host.clientWidth || 1; H = host.clientHeight || 1;
    renderer.setSize(W, H, false);
    var fw = W + inset.right, fh = H + inset.bottom;
    camera.aspect = fw / fh;
    camera.setViewOffset(fw, fh, inset.right, inset.bottom, W, H);
    camera.updateProjectionMatrix();
  }
  function loop() {
    requestAnimationFrame(loop);
    var dt = Math.min(clock.getDelta(), 0.05);
    if (morphAnim) {
      morphAnim.t = Math.min(1, morphAnim.t + dt / morphAnim.dur);
      morph = morphAnim.from + (morphAnim.to - morphAnim.from) * ease(morphAnim.t);
      if (morphAnim.t >= 1) { morph = morphAnim.to; morphAnim = null; }
      globeMat.uniforms.uMorph.value = morph;
      atmoMat.uniforms.uFade.value = 1 - morph;
      atmo.visible = morph < 0.99;
    }
    stepFly(dt);
    var idle = performance.now() - lastInteract > 4000;
    controls.autoRotate = opts.autoRotate && !opts.reduce && view === 'globe' && !morphAnim && !fly && !selected && idle;
    controls.autoRotateSpeed = opts.rotateSpeed;
    controls.update();
    globeMat.uniforms.uLight.value.copy(camera.position).normalize().add(new T.Vector3(-0.35, 0.55, 0)).normalize();
    updateBars(dt);
    updateArcs(dt);
    renderer.render(scene, camera);
    updateLabels();
  }

  /* ---------- 啟動 ---------- */
  S.init = function (o) {
    host = o.host; labelRoot = o.labels;
    if (o.opts) Object.keys(o.opts).forEach(function (k) { opts[k] = o.opts[k]; });
    return Promise.all([import('three'), import('three/addons/controls/OrbitControls.js'), loadWorld()]).then(function (mods) {
      T = mods[0]; Orbit = mods[1].OrbitControls;
      tmpV = new T.Vector3(); tmpN = new T.Vector3(); UP = new T.Vector3(0, 1, 0);
      clock = new T.Clock(); raycaster = new T.Raycaster();
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      host.appendChild(renderer.domElement);
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(42, 1, 0.1, 800);
      controls = new Orbit(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.6;
      scene.add(new T.AmbientLight(0xffffff, 1.6));
      var dl = new T.DirectionalLight(0xffffff, 1.6); dl.position.set(-0.4, 0.8, 1);
      camera.add(dl); scene.add(camera);

      buildGlobe();
      barGeo = new T.BoxGeometry(1, 1, 1); barGeo.translate(0, 0.5, 0);
      barGroup = new T.Group(); scene.add(barGroup);
      ring = new T.Mesh(new T.RingGeometry(0.42, 0.58, 40), new T.MeshBasicMaterial({ color: 0xffb703, side: T.DoubleSide, transparent: true, opacity: .95, depthWrite: false }));
      ring.visible = false; scene.add(ring);
      arcGroup = new T.Group(); scene.add(arcGroup);
      particleGeo = new T.BufferGeometry();
      particleGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(3), 3));
      particles = new T.Points(particleGeo, new T.PointsMaterial({ color: 0xfff1b8, size: 0.32, transparent: true, depthWrite: false }));
      arcGroup.add(particles);

      view = o.view === 'flat' ? 'flat' : 'globe';
      morph = view === 'flat' ? 1 : 0;
      globeMat.uniforms.uMorph.value = morph; atmoMat.uniforms.uFade.value = 1 - morph; atmo.visible = morph < 0.99;
      applyConstraints();
      new ResizeObserver(resize).observe(host);
      resize();
      if (view === 'flat') { camera.position.set(0, -10, flatDist()); controls.target.set(0, 0, 0); }
      else { normalAt(121, 20, 0, tmpN); camera.position.copy(tmpN).multiplyScalar(36); }
      bindPointer();
      S.ready = true;
      S.setOpts({});
      loop();
      return features;
    });
  };
  S.stats = function () {
    return { ready: S.ready, morph: morph, view: view, bars: barMeshes.filter(function (m) { return m.visible; }).length, arcs: arcs.length, features: features.length,
      labelsShown: Object.keys(labelEls).filter(function (k) { return labelEls[k].style.display !== 'none'; }).length };
  };
})();
