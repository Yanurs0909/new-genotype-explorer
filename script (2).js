/* =========================================================================
   Genotype Explorer - script.js

   이 파일은 크게 4부분으로 이루어져 있습니다.
   [1] 유전 엔진        : 표현형 -> 유전자형 변환, 교배(Punnett Square) 계산,
                          가족 정보를 이용한 조건 필터링(규칙 기반 추론)
   [2] 기본 탐색 UI 제어 : 폼 입력 -> 엔진 호출 -> 결과 화면(카드/차트) 렌더링
   [3] 다형질(심화) UI 제어
   [4] 공통 기능        : 다크모드, 기록 저장(LocalStorage), PDF/공유, 유효성 검사
   ========================================================================= */


/* =========================================================================
   [1] 유전 엔진 (Rule-based inference + Search/Filtering)
   ========================================================================= */

/**
 * 표현형(우성/열성)을 받아 가능한 유전자형 후보 배열을 돌려줍니다.
 * - 우성 표현형은 대문자 대립유전자를 하나 이상 가지므로 AA 또는 Aa가 가능합니다.
 * - 열성 표현형은 대문자 대립유전자가 전혀 없어야 하므로 aa 하나뿐입니다.
 * - phenotype이 빈 값(입력 안 함)이면 세 가지 유전자형이 모두 가능합니다(와일드카드).
 * @param {string} phenotype  "우성" | "열성" | "" (미입력)
 * @returns {string[]} 가능한 유전자형 목록
 */
function genotypeCandidates(phenotype) {
  if (phenotype === "우성") return ["AA", "Aa"];
  if (phenotype === "열성") return ["aa"];
  return ["AA", "Aa", "aa"]; // 정보가 없을 때는 모든 경우를 열어둔다
}

/**
 * 유전자형 문자열(예: "Aa")을 대립유전자 배열(['A','a'])로 쪼갭니다.
 */
function allelesOf(genotype) {
  return genotype.split("");
}

/**
 * 두 사람의 유전자형을 교배시켜(Punnett Square) 자손의 유전자형별 확률을 계산합니다.
 * 예: cross("Aa","Aa") => { AA: 0.25, Aa: 0.5, aa: 0.25 }
 * @param {string} g1 부모1 유전자형
 * @param {string} g2 부모2 유전자형
 * @returns {Object.<string, number>} 유전자형별 확률(합 = 1)
 */
function cross(g1, g2) {
  const a1 = allelesOf(g1);
  const a2 = allelesOf(g2);
  const counts = {};

  // 4칸짜리 Punnett Square를 순회하며 각 칸의 유전자형을 센다.
  a1.forEach((x) => {
    a2.forEach((y) => {
      // 대문자(A)가 앞에 오도록 정렬 -> "aA" 대신 "Aa"로 통일 표기
      const pair = [x, y].sort().join("");
      counts[pair] = (counts[pair] || 0) + 1;
    });
  });

  const total = a1.length * a2.length; // 항상 4
  const probs = {};
  Object.keys(counts).forEach((k) => {
    probs[k] = counts[k] / total;
  });
  return probs;
}

/** 유전자형으로부터 표현형(우성/열성)을 판단합니다. */
function phenotypeOfGenotype(genotype) {
  return genotype === "aa" ? "열성" : "우성";
}

/** 교배 결과(유전자형 확률)를 표현형 확률로 합산합니다. */
function phenotypeDistFromCross(g1, g2) {
  const genotypeProbs = cross(g1, g2);
  const dist = { 우성: 0, 열성: 0 };
  Object.keys(genotypeProbs).forEach((g) => {
    dist[phenotypeOfGenotype(g)] += genotypeProbs[g];
  });
  return dist;
}

/**
 * 두 후보군(부모 각각의 가능한 유전자형 목록)을 모든 경우로 교배했을 때
 * 목표 유전자형이 확률 0보다 크게 나올 수 있는지 확인합니다.
 * (조부모 조합으로부터 부모의 유전자형이 실제로 나올 수 있는지 검사할 때 사용)
 */
function canProduceGenotype(candidatesA, candidatesB, targetGenotype) {
  for (const a of candidatesA) {
    for (const b of candidatesB) {
      const probs = cross(a, b);
      if ((probs[targetGenotype] || 0) > 0) return true;
    }
  }
  return false;
}

/**
 * 기본 탐색의 핵심 함수. 부모/자녀/조부모 표현형 정보를 받아
 * STEP1~STEP6 알고리즘을 그대로 수행하고, 각 부모 유전자형 조합에 대한
 * 결과(유지/제거 및 이유, 자손 확률)를 배열로 반환합니다.
 *
 * @param {Object} input
 *   father, mother : "우성" | "열성"  (필수)
 *   child          : "우성" | "열성" | ""  (선택)
 *   gf, gm, mgf, mgm : "우성" | "열성" | "" (선택, 친/외 조부모)
 */
function exploreBasic(input) {
  // STEP 1: 표현형 -> 유전자형 후보 변환
  const fatherCands = genotypeCandidates(input.father);
  const motherCands = genotypeCandidates(input.mother);

  // STEP 2: 가능한 모든 부모 유전자형 조합 생성
  const combos = [];
  fatherCands.forEach((f) => {
    motherCands.forEach((m) => combos.push({ father: f, mother: m }));
  });

  // STEP 3~6: 각 조합마다 Punnett Square/확률 계산 후 조건 필터링
  return combos.map((combo) => {
    const genotypeDist = cross(combo.father, combo.mother); // STEP3,4 (유전자형)
    const phenotypeDist = phenotypeDistFromCross(combo.father, combo.mother); // STEP4 (표현형)

    const reasons = [];
    let eliminated = false;

    // --- 조건 1: 자녀 표현형과 비교 ---
    if (input.child) {
      const p = phenotypeDist[input.child] || 0;
      if (p === 0) {
        eliminated = true;
        reasons.push(
          `자녀가 ${input.child}인데, ${combo.father}×${combo.mother} 조합에서는 ${input.child} 자녀가 나올 수 없습니다.`
        );
      }
    }

    // --- 조건 2: 친가(할아버지/할머니)로부터 아버지 유전자형이 나올 수 있는지 ---
    if (input.gf || input.gm) {
      const gfCands = input.gf ? genotypeCandidates(input.gf) : ["AA", "Aa", "aa"];
      const gmCands = input.gm ? genotypeCandidates(input.gm) : ["AA", "Aa", "aa"];
      if (!canProduceGenotype(gfCands, gmCands, combo.father)) {
        eliminated = true;
        reasons.push(
          `아버지의 유전자형(${combo.father})은 할아버지·할머니의 표현형 조합으로는 나올 수 없습니다.`
        );
      }
    }

    // --- 조건 3: 외가(외할아버지/외할머니)로부터 어머니 유전자형이 나올 수 있는지 ---
    if (input.mgf || input.mgm) {
      const mgfCands = input.mgf ? genotypeCandidates(input.mgf) : ["AA", "Aa", "aa"];
      const mgmCands = input.mgm ? genotypeCandidates(input.mgm) : ["AA", "Aa", "aa"];
      if (!canProduceGenotype(mgfCands, mgmCands, combo.mother)) {
        eliminated = true;
        reasons.push(
          `어머니의 유전자형(${combo.mother})은 외할아버지·외할머니의 표현형 조합으로는 나올 수 없습니다.`
        );
      }
    }

    return { ...combo, genotypeDist, phenotypeDist, eliminated, reasons };
  });
}


/* ---- ABO 혈액형 전용 엔진 (다형질 탐색에서 사용, 복대립유전) ---- */

function abo_candidates(phenotype) {
  switch (phenotype) {
    case "A": return ["IAIA", "IAIO"];
    case "B": return ["IBIB", "IBIO"];
    case "AB": return ["IAIB"];
    case "O": return ["IOIO"];
    default: return ["IAIA", "IAIO", "IBIB", "IBIO", "IAIB", "IOIO"];
  }
}
// "IAIO" 같은 문자열을 ["IA","IO"] 두 개의 대립유전자 토큰으로 분리
function abo_alleles(genotype) {
  return genotype.match(/I[ABO]/g);
}
function abo_cross(g1, g2) {
  const a1 = abo_alleles(g1);
  const a2 = abo_alleles(g2);
  const counts = {};
  a1.forEach((x) => {
    a2.forEach((y) => {
      const pair = [x, y].sort().join(""); // IA < IB < IO 순서로 정렬해 표기 통일
      counts[pair] = (counts[pair] || 0) + 1;
    });
  });
  const probs = {};
  Object.keys(counts).forEach((k) => { probs[k] = counts[k] / 4; });
  return probs;
}
function abo_phenotype(genotype) {
  const has = (t) => genotype.includes(t);
  if (has("IA") && has("IB")) return "AB";
  if (has("IA")) return "A";
  if (has("IB")) return "B";
  return "O";
}


/* =========================================================================
   [2] 기본 탐색 - UI 제어
   ========================================================================= */

let lastBasicResults = null;   // 마지막 탐색 결과(공유/PDF 등에서 재사용)
let lastBasicInput = null;
let genotypeChartInstance = null;
let phenotypeChartInstance = null;

const basicForm = document.getElementById("basicForm");
const formError = document.getElementById("formError");

basicForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const input = readRadioGroups(basicForm, ["father", "mother", "child", "gf", "gm", "mgf", "mgm"]);

  // 잘못된 입력 방지: 아버지/어머니 표현형은 필수
  if (!input.father || !input.mother) {
    showFormError(formError, "아버지와 어머니의 표현형은 반드시 선택해야 합니다.");
    return;
  }
  hideFormError(formError);

  const traitNameInput = document.getElementById("traitName").value.trim();
  const traitName = traitNameInput || "형질 A";

  const results = exploreBasic(input);
  lastBasicResults = results;
  lastBasicInput = { ...input, traitName };

  renderBasicResults(results, lastBasicInput);
  saveHistory({
    type: "basic",
    traitName,
    input,
    remaining: results.filter((r) => !r.eliminated).map((r) => `${r.father}×${r.mother}`),
  });

  document.getElementById("resultsBasic").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("resetBtn").addEventListener("click", () => {
  basicForm.reset();
  hideFormError(formError);
  document.getElementById("resultsBasic").classList.add("hidden");
  setActiveStep(0);
});

/**
 * 폼 안에서 각 name(라디오 그룹)에 대해 선택된 값을 읽어 객체로 반환합니다.
 * 선택되지 않았다면 빈 문자열("")을 값으로 넣습니다.
 */
function readRadioGroups(form, names) {
  const result = {};
  names.forEach((name) => {
    const checked = form.querySelector(`input[name="${name}"]:checked`);
    result[name] = checked ? checked.value : "";
  });
  return result;
}

function showFormError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideFormError(el) {
  el.classList.add("hidden");
}

/** 좌측 STEP 진행 표시를 갱신합니다 (0이면 전체 초기화). */
function setActiveStep(stepNum) {
  document.querySelectorAll("#processRail .step").forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle("active", n === stepNum);
    el.classList.toggle("done", n < stepNum);
  });
}

/**
 * 탐색 결과 배열을 받아 결과 화면 전체(요약/제거 보드/상세)를 그립니다.
 */
function renderBasicResults(results, input) {
  const wrap = document.getElementById("resultsBasic");
  wrap.classList.remove("hidden");
  setActiveStep(6);

  // --- 최종 남은 유전자형 요약 ---
  const remaining = results.filter((r) => !r.eliminated);
  const finalList = document.getElementById("finalList");
  const summarySub = document.getElementById("summarySub");
  finalList.innerHTML = "";

  if (remaining.length === 0) {
    summarySub.textContent = "입력된 조건과 일치하는 조합이 없습니다. 입력값을 다시 확인해보세요.";
  } else if (remaining.length === results.length) {
    summarySub.textContent = `"${input.traitName}"에 대해 아직 후보를 좁힐 추가 정보가 없습니다. 자녀/조부모 정보를 입력하면 더 좁혀집니다.`;
  } else {
    summarySub.textContent = `총 ${results.length}개 조합 중 ${remaining.length}개가 조건과 일치합니다.`;
  }

  remaining.forEach((r) => {
    const chip = document.createElement("span");
    chip.className = "final-chip";
    chip.textContent = `${r.father} × ${r.mother}`;
    finalList.appendChild(chip);
  });
  if (remaining.length === 0) {
    const chip = document.createElement("span");
    chip.className = "final-empty";
    chip.textContent = "가능한 조합 없음";
    finalList.appendChild(chip);
  }

  // --- 탐색(제거) 보드 ---
  const board = document.getElementById("eliminationBoard");
  board.innerHTML = "";
  results.forEach((r, idx) => {
    const item = document.createElement("div");
    item.className = "board-item" + (r.eliminated ? " eliminated" : "");
    item.dataset.idx = idx;

    const status = document.createElement("span");
    status.className = "board-status " + (r.eliminated ? "removed" : "kept");
    status.textContent = r.eliminated ? "제거됨" : "유지";

    const combo = document.createElement("div");
    combo.className = "board-combo";
    combo.textContent = `${r.father} × ${r.mother}`;

    const reasonList = document.createElement("ul");
    reasonList.className = "board-reasons";
    if (r.reasons.length) {
      r.reasons.forEach((reason) => {
        const li = document.createElement("li");
        li.textContent = "· " + reason;
        reasonList.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent = "· 입력된 조건과 모두 일치합니다.";
      reasonList.appendChild(li);
    }

    item.appendChild(status);
    item.appendChild(combo);
    item.appendChild(reasonList);

    item.addEventListener("click", () => selectCombo(idx, results, input));
    board.appendChild(item);
  });

  // 첫 번째로 "유지된" 조합을 자동으로 상세 보기에 표시(있다면)
  const firstKeptIdx = results.findIndex((r) => !r.eliminated);
  if (firstKeptIdx !== -1) {
    selectCombo(firstKeptIdx, results, input);
  } else {
    document.getElementById("detailArea").classList.add("hidden");
    document.getElementById("detailHint").textContent = "조건에 맞는 조합이 없어 상세 정보를 표시할 수 없습니다.";
  }
}

/** 탐색 보드에서 특정 조합을 클릭했을 때 상세(Punnett square + 차트)를 그립니다. */
function selectCombo(idx, results, input) {
  document.querySelectorAll("#eliminationBoard .board-item").forEach((el) => {
    el.classList.toggle("selected", Number(el.dataset.idx) === idx);
  });

  const r = results[idx];
  const detailArea = document.getElementById("detailArea");
  const detailHint = document.getElementById("detailHint");
  detailArea.classList.remove("hidden");
  detailHint.textContent = `"${input.traitName}" — ${r.father} × ${r.mother} 조합의 상세 결과입니다.`;

  document.getElementById("punnettTitle").textContent = `Punnett Square (${r.father} × ${r.mother})`;
  document.getElementById("punnettTable").innerHTML = buildPunnettHTML(r.father, r.mother);

  drawGenotypeChart(r.genotypeDist);
  drawPhenotypeChart(r.phenotypeDist);
}

/** 두 유전자형으로부터 Punnett Square HTML 표를 문자열로 생성합니다. */
function buildPunnettHTML(g1, g2) {
  const a1 = allelesOf(g1);
  const a2 = allelesOf(g2);

  let html = '<table class="punnett"><thead><tr><th></th>';
  a2.forEach((allele) => { html += `<th>${allele}</th>`; });
  html += "</tr></thead><tbody>";

  a1.forEach((rowAllele) => {
    html += `<tr><th>${rowAllele}</th>`;
    a2.forEach((colAllele) => {
      const combined = [rowAllele, colAllele].sort().join("");
      const cls = combined === "aa" ? "recessive" : "dominant";
      html += `<td class="${cls}">${combined}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  return html;
}

/** 자녀 유전자형 확률을 막대그래프(Chart.js)로 그립니다. */
function drawGenotypeChart(genotypeDist) {
  const ctx = document.getElementById("genotypeChart");
  const labels = Object.keys(genotypeDist);
  const data = labels.map((k) => Math.round(genotypeDist[k] * 100));

  if (genotypeChartInstance) genotypeChartInstance.destroy();
  genotypeChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "확률(%)", data, backgroundColor: "#2C6ECB", borderRadius: 6 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, max: 100, ticks: { stepSize: 25 } } },
    },
  });
}

/** 자녀 표현형 확률을 도넛 차트(Chart.js)로 그립니다. */
function drawPhenotypeChart(phenotypeDist) {
  const ctx = document.getElementById("phenotypeChart");
  const labels = Object.keys(phenotypeDist);
  const data = labels.map((k) => Math.round(phenotypeDist[k] * 100));

  if (phenotypeChartInstance) phenotypeChartInstance.destroy();
  phenotypeChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: ["#14B8A6", "#E2554F"] }],
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } },
  });
}


/* =========================================================================
   [3] 다형질(심화) 탐색 - UI 제어
   ========================================================================= */

let multiChartInstance = null;

const multiForm = document.getElementById("multiForm");
const multiFormError = document.getElementById("multiFormError");

multiForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const input = readRadioGroups(multiForm, [
    "blood_father", "blood_mother",
    "tongue_father", "tongue_mother",
    "earlobe_father", "earlobe_mother",
  ]);

  const requiredPairs = [
    ["blood_father", "blood_mother"],
    ["tongue_father", "tongue_mother"],
    ["earlobe_father", "earlobe_mother"],
  ];
  const missing = requiredPairs.some(([a, b]) => !input[a] || !input[b]);
  if (missing) {
    showFormError(multiFormError, "세 형질 모두 아버지·어머니 표현형을 선택해야 합니다.");
    return;
  }
  hideFormError(multiFormError);

  const traitResults = computeMultiTrait(input);
  renderMultiResults(traitResults);

  saveHistory({
    type: "multi",
    input,
    remaining: traitResults.blood.combos.length + traitResults.tongue.combos.length + traitResults.earlobe.combos.length,
  });

  document.getElementById("resultsMulti").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("multiResetBtn").addEventListener("click", () => {
  multiForm.reset();
  hideFormError(multiFormError);
  document.getElementById("resultsMulti").classList.add("hidden");
});

/**
 * 세 형질(혈액형/혀 말기/귓불 모양)에 대해 각각 부모 유전자형 후보 조합과
 * 자녀 표현형 확률을 계산합니다. 서로 다른 염색체에 있는 독립적인 유전자로
 * 가정하므로(독립의 법칙), 이후 조합 확률은 각 형질 확률의 곱으로 계산됩니다.
 */
function computeMultiTrait(input) {
  // 혈액형(ABO, 복대립유전)
  const bloodFatherCands = abo_candidates(input.blood_father);
  const bloodMotherCands = abo_candidates(input.blood_mother);
  const bloodCombos = [];
  bloodFatherCands.forEach((f) => bloodMotherCands.forEach((m) => {
    const genoDist = abo_cross(f, m);
    const phenoDist = {};
    Object.keys(genoDist).forEach((g) => {
      const p = abo_phenotype(g);
      phenoDist[p] = (phenoDist[p] || 0) + genoDist[g];
    });
    bloodCombos.push({ father: f, mother: m, genoDist, phenoDist });
  }));

  // 혀 말기 / 귓불 모양 (단순 우열, 기본 엔진 재사용)
  function simpleTrait(fatherPheno, motherPheno) {
    const fCands = genotypeCandidates(fatherPheno);
    const mCands = genotypeCandidates(motherPheno);
    const combos = [];
    fCands.forEach((f) => mCands.forEach((m) => {
      combos.push({ father: f, mother: m, genoDist: cross(f, m), phenoDist: phenotypeDistFromCross(f, m) });
    }));
    return { combos };
  }

  return {
    blood: { combos: bloodCombos },
    tongue: simpleTrait(input.tongue_father, input.tongue_mother),
    earlobe: simpleTrait(input.earlobe_father, input.earlobe_mother),
  };
}

let multiJointCombos = []; // 전체 조합 테이블에서 선택 시 사용하기 위해 저장

function renderMultiResults(traitResults) {
  const wrap = document.getElementById("resultsMulti");
  wrap.classList.remove("hidden");

  // --- 형질별 가능한 부모 유전자형 요약 카드 ---
  const perTraitWrap = document.getElementById("multiPerTrait");
  perTraitWrap.innerHTML = "";

  const traitMeta = [
    { key: "blood", label: "ABO 혈액형" },
    { key: "tongue", label: "혀 말기" },
    { key: "earlobe", label: "귓불 모양" },
  ];

  traitMeta.forEach(({ key, label }) => {
    const card = document.createElement("div");
    card.className = "trait-summary-card";
    const title = document.createElement("h3");
    title.textContent = label;
    card.appendChild(title);
    traitResults[key].combos.forEach((c) => {
      const chip = document.createElement("span");
      chip.className = "final-chip";
      chip.textContent = `${c.father} × ${c.mother}`;
      card.appendChild(chip);
    });
    perTraitWrap.appendChild(card);
  });

  // --- 전체 조합 테이블 (세 형질의 부모 유전자형 조합을 모두 곱해서 나열) ---
  multiJointCombos = [];
  traitResults.blood.combos.forEach((b) => {
    traitResults.tongue.combos.forEach((t) => {
      traitResults.earlobe.combos.forEach((e) => {
        multiJointCombos.push({ blood: b, tongue: t, earlobe: e });
      });
    });
  });

  const table = document.getElementById("multiTable");
  let html = "<thead><tr><th>혈액형 부모</th><th>혀 말기 부모</th><th>귓불 모양 부모</th></tr></thead><tbody>";
  multiJointCombos.forEach((jc, idx) => {
    html += `<tr data-idx="${idx}">
      <td>${jc.blood.father} × ${jc.blood.mother}</td>
      <td>${jc.tongue.father} × ${jc.tongue.mother}</td>
      <td>${jc.earlobe.father} × ${jc.earlobe.mother}</td>
    </tr>`;
  });
  html += "</tbody>";
  table.innerHTML = html;

  table.querySelectorAll("tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      table.querySelectorAll("tbody tr").forEach((el) => el.classList.remove("row-selected"));
      tr.classList.add("row-selected");
      selectMultiCombo(Number(tr.dataset.idx));
    });
  });

  if (multiJointCombos.length) {
    table.querySelector("tbody tr").classList.add("row-selected");
    selectMultiCombo(0);
  }

  renderTraitDetail(traitResults);
}

/** 확률 분포 객체(예: {AA:0.25, Aa:0.5, aa:0.25})를 "AA: 25% · Aa: 50% · aa: 25%" 형태의 문자열로 변환합니다. */
function formatDist(dist) {
  return Object.keys(dist)
    .map((k) => `${k}: ${Math.round(dist[k] * 1000) / 10}%`)
    .join(" · ");
}

/**
 * 전체 조합 표와는 별도로, 형질 하나하나에 대해
 * "부모 유전자형 조합 → 자녀 유전자형 확률 → 자녀 표현형(조합) 확률"을
 * 표 형태로 각각 보여줍니다.
 */
function renderTraitDetail(traitResults) {
  const wrap = document.getElementById("traitDetailArea");
  wrap.innerHTML = "";

  const traitMeta = [
    { key: "blood", label: "ABO 혈액형" },
    { key: "tongue", label: "혀 말기" },
    { key: "earlobe", label: "귓불 모양" },
  ];

  traitMeta.forEach(({ key, label }) => {
    const block = document.createElement("div");
    block.className = "trait-detail-block";

    const title = document.createElement("h3");
    title.className = "mini-title";
    title.textContent = label;
    block.appendChild(title);

    const tableWrap = document.createElement("div");
    tableWrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "data-table";

    let html = "<thead><tr><th>부모 유전자형 조합</th><th>자녀 유전자형 확률</th><th>자녀 표현형(조합) 확률</th></tr></thead><tbody>";
    traitResults[key].combos.forEach((c) => {
      html += `<tr>
        <td>${c.father} × ${c.mother}</td>
        <td>${formatDist(c.genoDist)}</td>
        <td>${formatDist(c.phenoDist)}</td>
      </tr>`;
    });
    html += "</tbody>";
    table.innerHTML = html;

    tableWrap.appendChild(table);
    block.appendChild(tableWrap);
    wrap.appendChild(block);
  });
}

/** 다형질 조합 테이블에서 한 행을 선택하면, 세 형질 표현형 조합의 결합 확률을 계산해 차트로 표시합니다. */
function selectMultiCombo(idx) {
  const jc = multiJointCombos[idx];
  if (!jc) return;

  // 세 형질이 서로 다른 염색체(독립 유전)라고 가정 -> 결합 확률 = 각 확률의 곱
  const jointDist = {};
  Object.keys(jc.blood.phenoDist).forEach((bp) => {
    Object.keys(jc.tongue.phenoDist).forEach((tp) => {
      Object.keys(jc.earlobe.phenoDist).forEach((ep) => {
        const label = `${bp}형 · 혀${tp === "우성" ? "O" : "X"} · 귓불${ep === "우성" ? "분리" : "부착"}`;
        const prob = jc.blood.phenoDist[bp] * jc.tongue.phenoDist[tp] * jc.earlobe.phenoDist[ep];
        if (prob > 0) jointDist[label] = (jointDist[label] || 0) + prob;
      });
    });
  });

  const ctx = document.getElementById("multiChart");
  const labels = Object.keys(jointDist);
  const data = labels.map((k) => Math.round(jointDist[k] * 1000) / 10); // 소수점 1자리 %

  if (multiChartInstance) multiChartInstance.destroy();
  multiChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "확률(%)", data, backgroundColor: "#14B8A6", borderRadius: 6 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, max: 100 } },
    },
  });
}


/* =========================================================================
   [4] 공통 기능 : 탭 전환 / 다크모드 / 기록 / PDF / 공유
   ========================================================================= */

/* ---- 탭 전환 ---- */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");

    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

/* ---- 다크 모드 (LocalStorage에 저장) ---- */
const themeToggle = document.getElementById("themeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem("genotypeExplorerTheme", theme);
}
themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});
// 저장된 테마 또는 시스템 설정을 따라 초기 테마 적용
(function initTheme() {
  const saved = localStorage.getItem("genotypeExplorerTheme");
  if (saved) applyTheme(saved);
  else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) applyTheme("dark");
})();

/* ---- 탐색 기록 (LocalStorage) ---- */
const HISTORY_KEY = "genotypeExplorerHistory";
const MAX_HISTORY = 20;

function saveHistory(entry) {
  const list = getHistory();
  list.unshift({ ...entry, time: new Date().toISOString() });
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  renderHistoryList();
}
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}
function renderHistoryList() {
  const listEl = document.getElementById("historyList");
  const list = getHistory();
  listEl.innerHTML = "";

  if (list.length === 0) {
    listEl.innerHTML = '<p class="hint">아직 저장된 기록이 없습니다.</p>';
    return;
  }

  list.forEach((entry, idx) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const t = document.createElement("time");
    t.textContent = new Date(entry.time).toLocaleString("ko-KR");

    const desc = document.createElement("div");
    if (entry.type === "basic") {
      desc.textContent = `[${entry.traitName}] 아버지:${entry.input.father} 어머니:${entry.input.mother} → 남은 후보 ${entry.remaining.length}개 (${entry.remaining.join(", ") || "없음"})`;
    } else {
      desc.textContent = `[다형질 탐색] 전체 조합 ${entry.remaining}개 생성`;
    }

    const del = document.createElement("button");
    del.className = "del-btn";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      const l = getHistory();
      l.splice(idx, 1);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(l));
      renderHistoryList();
    });

    item.appendChild(t);
    item.appendChild(desc);
    item.appendChild(del);
    listEl.appendChild(item);
  });
}

const historyPanel = document.getElementById("historyPanel");
const historyOverlay = document.getElementById("historyOverlay");
document.getElementById("historyToggle").addEventListener("click", () => {
  renderHistoryList();
  historyPanel.classList.remove("hidden");
  historyOverlay.classList.remove("hidden");
});
document.getElementById("closeHistory").addEventListener("click", closeHistoryPanel);
historyOverlay.addEventListener("click", closeHistoryPanel);
function closeHistoryPanel() {
  historyPanel.classList.add("hidden");
  historyOverlay.classList.add("hidden");
}
document.getElementById("clearHistory").addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistoryList();
  showToast("기록을 모두 삭제했습니다.");
});

/* ---- 토스트 알림 ---- */
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 2400);
}

/* ---- 초기 기록 렌더링 ---- */
renderHistoryList();
