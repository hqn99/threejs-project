import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { FirstPersonControls } from "three/addons/controls/FirstPersonControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { Reflector } from "three/addons/objects/Reflector.js";

async function main() {
  // レンダラー
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // rendererをHTMLに追加
  document.body.appendChild(renderer.domElement);

  // シーン
  const scene = new THREE.Scene();

  // 場所の設定シート
  const areaData = {
    room: {
      mtl: "./model/room/02100039.mtl",
      obj: "./model/room/02100039.obj",
      spawn: { x: -120, y: 160, z: -110 },
      lookAt: { x: -180, y: 120, z: 300 },
    },
    kitchen: {
      mtl: "./model/kitchen/02100038.mtl",
      obj: "./model/kitchen/02100038.obj",
      spawn: { x: 130, y: 160, z: 0 },
      lookAt: { x: -20, y: 120, z: -300 },
    },
    outside: {
      mtl: "./model/",
      obj: "./model/",
      spawn: { x: 0, y: 160, z: 0 },
      lookAt: { x: 0, y: 120, z: 0 },
    },
    station: {
      mtl: "./model/",
      obj: "./model/",
      spawn: { x: 0, y: 160, z: 0 },
      lookAt: { x: 0, y: 120, z: 0 },
    },
  };

  // オブジェクトが最初は空
  let currentObject = null;

  // カメラ
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );

  //時計
  const clock = new THREE.Clock();
  const clockElement = document.getElementById("clock-display");

  // ダイアログ要素を取得
  const dialog = document.getElementById("custom-dialog");
  const dialogMessage = document.getElementById("dialog-message");
  const btnYes = document.getElementById("btn-yes");
  const btnNo = document.getElementById("btn-no");
  let pendingArea = null; // どこに移動するか一時的に覚えておく

  // --- 視点の手動移動と右クリック判定 ---
  const controls = new FirstPersonControls(camera, renderer.domElement);
  controls.lookSpeed = 0.05;
  controls.movementSpeed = 0;
  controls.lookVertical = true;
  controls.constrainVertical = true;
  controls.activeLook = false;

  // クリック判定用のツール
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  // ライト
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const pointLight = new THREE.PointLight(0xffffff, 50000);
  scene.add(pointLight); //ここ，自分のx z座標のy250の位置に欲しい，それか部屋ごとに分けたい

  // --- 空（Skyシェーダー）のセットアップ ---
  const sky = new Sky();
  sky.scale.setScalar(450000); // 巨大な空の箱を作る
  scene.add(sky);

  const sun = new THREE.Vector3(); // 太陽の座標

  // Skyの見た目（大気の状態）を設定
  const effectController = {
    turbidity: 10, // 濁り
    rayleigh: 3, // 光の散乱（青空の強さ）
    mieCoefficient: 0.005,
    mieDirectionalG: 0.7,
    elevation: 2, // 太陽の高さ
    azimuth: 180, // 太陽の方角
    exposure: renderer.toneMappingExposure,
  };

  function updateEnvironment(hour) {
    const phi = THREE.MathUtils.degToRad(80); // 少し傾ける
    const theta = THREE.MathUtils.degToRad(180);

    sun.setFromSphericalCoords(1, phi, theta);
    sky.material.uniforms["sunPosition"].value.copy(sun);

    sky.material.uniforms["turbidity"].value = 0.1; // 低くすると澄んだ青空になる
    sky.material.uniforms["rayleigh"].value = 1; // 高くすると青みが深まる

    renderer.toneMappingExposure = 0.5;
  }

  //床
  const groundGeometry = new THREE.PlaneGeometry(10000, 10000); // 巨大な板
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x444444, // 地面の色（濃いグレー）
    roughness: 0.8,
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2; // 横に倒して床にする
  ground.position.y = 0; // 地面の高さ（部屋の床の高さに合わせて調整してください）
  scene.add(ground);

  // ロード画面
  async function loadArea(areaKey) {
    const loaderScreen = document.getElementById("loading-screen");
    if (loaderScreen) loaderScreen.classList.remove("fade-out");

    // 古いモデルを削除
    if (currentObject) scene.remove(currentObject);

    // ★「RealMirror」で始まるオブジェクトをすべて確実に削除
    const mirrorsToRemove = [];
    scene.traverse((child) => {
      if (child.name && child.name.startsWith("RealMirror")) {
        mirrorsToRemove.push(child);
      }
    });
    mirrorsToRemove.forEach((m) => {
      scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.getRenderTarget) m.getRenderTarget().dispose(); // リソース解放
    });

    // 前のエリアで作った鏡があれば削除（これをしないと鏡が溜まって重くなります）
    const oldMirror = scene.getObjectByName("RealMirror");
    if (oldMirror) {
      scene.remove(oldMirror);
      oldMirror.geometry.dispose();
      oldMirror.getRenderTarget().dispose(); // リソース解放
    }

    const data = areaData[areaKey];

    // モデル読み込み
    const mtlLoader = new MTLLoader();
    const mtl = await new Promise((resolve) =>
      mtlLoader.load(data.mtl, resolve),
    );
    mtl.preload();

    const objLoader = new OBJLoader().setMaterials(mtl);
    const root = await new Promise((resolve) =>
      objLoader.load(data.obj, resolve),
    );

    // --- ★鏡の置き換え処理を追加★ ---
    root.traverse((child) => {
      if (child.isMesh) {
        // どんな名前で認識されているか全部出す
        // console.log("Mesh found:", child.name);

        if (child.name.includes("Mirror_Mesh")) {
          console.log("★Mirror_Meshを発見！鏡に変換します:", child.name);

          const mirror = new Reflector(child.geometry, {
            clipBias: 0.003,
            textureWidth: window.innerWidth * window.devicePixelRatio,
            textureHeight: window.innerHeight * window.devicePixelRatio,
            color: 0x333333, // 一旦真っ白（100%反射）にする
          });
          // 名前を固定せず、ユニークにする（複数鏡がある場合のため）
          mirror.name = "RealMirror_" + child.name;

          child.updateWorldMatrix(true, false);
          mirror.position.setFromMatrixPosition(child.matrixWorld);
          mirror.quaternion.setFromRotationMatrix(child.matrixWorld);
          // mirror.scale.setFromMatrixScale(child.matrixWorld);
          // mirror.rotateY(Math.PI);

          mirror.scale.set(1, 1, 1);

          // ★デバッグ用：鏡がどこにあるか赤く光らせてみる
          // mirror.getRenderTarget().texture.encoding = THREE.sRGBEncoding;

          child.visible = false;
          root.add(mirror);
        }
      }
    });

    scene.add(root);
    currentObject = root;

    pointLight.position.set(data.spawn.x, 250, data.spawn.z);

    camera.position.set(data.spawn.x, data.spawn.y, data.spawn.z);
    controls.lookAt(data.lookAt.x, data.lookAt.y, data.lookAt.z);

    setTimeout(() => {
      if (loaderScreen) loaderScreen.classList.add("fade-out");
    }, 500);

    window.currentLocation = areaKey;
  }

  // クリック・移動判定
  renderer.domElement.addEventListener("contextmenu", (e) =>
    e.preventDefault(),
  );

  renderer.domElement.addEventListener("mousedown", (event) => {
    // --- 【左クリック：視点移動開始】 ---
    if (event.button === 0) {
      controls.activeLook = true;
    }

    // --- 【右クリック：移動判定】 ---
    if (event.button === 2) {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      if (intersects.length > 0) {
        const p = intersects[0].point;

        console.log(
          `Clicked Coordinates: x=${p.x.toFixed(2)}, y=${p.y.toFixed(2)}, z=${p.z.toFixed(2)}`,
        );

        const loc = window.currentLocation;

        // ダイアログを出して移動を予約する共通関数
        const showDialog = (msg, nextArea) => {
          if (dialogMessage && dialog) {
            dialogMessage.innerText = msg;
            pendingArea = nextArea;
            dialog.classList.remove("hidden");
            controls.activeLook = false; // ダイアログ中は視点移動を止める
          }
        };

        // --- 移動ルール（全エリア分） ---
        if (loc === "room") {
          // 部屋からキッチンへの扉
          if (
            p.x >= 45 &&
            p.x <= 55 &&
            p.y >= 15 &&
            p.y <= 200 &&
            p.z >= -40 &&
            p.z <= 130
          ) {
            showDialog("GO TO THE KITCHEN?", "kitchen");
          }
          // 部屋から駅へ（x座標が大きい方へ）
          else if (p.x >= 140) {
            showDialog("GO TO THE STATION?", "station");
          }
        } else if (loc === "kitchen") {
          // キッチンから外へ
          if (
            p.x >= 180 &&
            p.x <= 225 && // xの範囲
            p.y >= 15 &&
            p.y <= 235 && // yの範囲
            p.z >= 100 &&
            p.z <= 305 // zの範囲
          ) {
            showDialog("GO OUTSIDE?", "outside");
          }
          // キッチンから部屋への扉（座標はroomの時と同じ）
          else if (
            p.x >= 45 &&
            p.x <= 55 &&
            p.y >= 15 &&
            p.y <= 200 &&
            p.z >= -40 &&
            p.z <= 130
          ) {
            showDialog("GO TO THE ROOM?", "room");
          }
        } else if (loc === "outside") {
          // 外からキッチンへ（どこをクリックしても戻る設定の場合）
          showDialog("GO TO THE KITCHEN?", "kitchen");
        } else if (loc === "station") {
          // 駅から部屋へ
          showDialog("GO TO THE ROOM?", "room");
        }
      }
    }
  });

  renderer.domElement.addEventListener("mouseup", () => {
    controls.activeLook = false;
  });

  renderer.domElement.addEventListener("mouseleave", () => {
    controls.activeLook = false;
  });

  // 「はい」を押したら移動
  btnYes.onclick = () => {
    if (pendingArea) loadArea(pendingArea);
    dialog.classList.add("hidden");
  };

  // 「いいえ」を押したら閉じるだけ
  btnNo.onclick = () => {
    dialog.classList.add("hidden");
  };

  // 最初のロード
  await loadArea("room");

  // シーンのレンダリング
  function animate() {
    const delta = clock.getDelta();
    controls.update(delta);

    pointLight.position.set(camera.position.x, 250, camera.position.z);

    // --- 現実の時間を取得 ---
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();

    // 1. 空の更新用（小数点まで含めた時間、例：14.5時間）
    updateEnvironment(12.0);

    // 2. 画面右上の時計表示を更新
    if (clockElement) {
      // 1桁の時に「0」を付けて 09:05:01 のように表示する
      clockElement.innerText = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(animate);
}
main();
