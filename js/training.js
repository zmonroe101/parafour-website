// ═══════════════════════════════════════════════════════════════
//  training.js — Intro training pages logic
//  Depends on: auth.js, portal.js (esc/setText helpers),
//              access.js (hasAccess), training-content.js
//
//  Pages:
//    /portal/training.html         → initTrainingList(portalUser)
//    /portal/training-module.html  → initTrainingModulePage(portalUser)
//    /portal/certificate.html      → initCertificatePage(portalUser)
//
//  Progress lives in Supabase (training_progress); quiz questions in
//  training_quiz_questions; lesson bodies in training-content.js.
//  Pass mark: 80%. Certificate unlocks when all 5 modules complete.
// ═══════════════════════════════════════════════════════════════

const TRAINING_PASS_MARK = 80; // percent
const TRAINING_MODULE_COUNT = 5;

// ─── shared data helpers ─────────────────────────────────────────

async function fetchTrainingProgress(portalUser) {
  const { data, error } = await supabase
    .from('training_progress')
    .select('*')
    .eq('user_id', portalUser.id);
  if (error) return { rows: [], error };
  return { rows: data ?? [], error: null };
}

function progressByModuleUuid(rows) {
  const map = {};
  rows.forEach(r => { map[r.module_id] = r; });
  return map;
}

function completedCount(rows) {
  const uuids = Object.values(TRAINING_MODULE_UUIDS);
  return rows.filter(r => r.status === 'completed' && uuids.includes(r.module_id)).length;
}

// ─── Training list page (training.html) ──────────────────────────

async function initTrainingList(portalUser) {
  const { rows, error } = await fetchTrainingProgress(portalUser);
  const byUuid = progressByModuleUuid(rows);
  const done = completedCount(rows);

  if (error) {
    const alertEl = document.getElementById('trainingAlert');
    if (alertEl) {
      alertEl.textContent = 'Could not load your training progress — the training database tables may not be set up yet (run supabase/subscription-model-schema.sql).';
      alertEl.className = 'portal-alert portal-alert-error visible';
    }
  }

  // Progress bar
  setText('trainingDone', done);
  const fill = document.getElementById('trainingProgressFill');
  if (fill) fill.style.width = `${(done / TRAINING_MODULE_COUNT) * 100}%`;

  // Module cards
  const list = document.getElementById('moduleList');
  if (list) {
    list.innerHTML = [1, 2, 3, 4, 5].map(n => {
      const content = TRAINING_CONTENT[n];
      const prog = byUuid[TRAINING_MODULE_UUIDS[n]];
      return `
        <a href="/portal/training-module.html?m=${n}" class="training-module-card">
          <div class="training-module-num">${n}</div>
          <div class="training-module-body">
            <h3>${esc(content.title)}</h3>
            <p>${esc(content.summary)}</p>
            <span class="training-module-meta">~${content.minutes} min · quiz included</span>
          </div>
          <div class="training-module-status">${trainingStatusPill(prog)}</div>
        </a>
      `;
    }).join('');
  }

  // Certificate card
  const certCard = document.getElementById('certificateCard');
  if (certCard) {
    if (done >= TRAINING_MODULE_COUNT) {
      certCard.innerHTML = `
        <div class="portal-doc-card-icon">🏆</div>
        <h3>Certificate Earned!</h3>
        <p>You've completed all ${TRAINING_MODULE_COUNT} intro modules. View and print your Certificate of Completion.</p>
        <a href="/portal/certificate.html" class="btn btn-primary">View Certificate</a>
      `;
      certCard.classList.add('training-cert-earned');
    } else {
      certCard.innerHTML = `
        <div class="portal-doc-card-icon">🎓</div>
        <h3>Certificate of Completion</h3>
        <p>Complete all ${TRAINING_MODULE_COUNT} modules (pass each quiz with ${TRAINING_PASS_MARK}%+) to earn a printable certificate. ${done} of ${TRAINING_MODULE_COUNT} done.</p>
      `;
    }
  }
}

function trainingStatusPill(prog) {
  if (prog?.status === 'completed') {
    return `<span class="training-pill training-pill-done">✓ Completed${Number.isFinite(prog.quiz_score) ? ` · ${prog.quiz_score}%` : ''}</span>`;
  }
  if (prog?.status === 'in_progress') {
    return '<span class="training-pill training-pill-progress">In progress</span>';
  }
  return '<span class="training-pill training-pill-new">Not started</span>';
}

// ─── Module page (training-module.html?m=N) ──────────────────────

async function initTrainingModulePage(portalUser) {
  const m = Number(new URLSearchParams(window.location.search).get('m'));
  if (!Number.isInteger(m) || m < 1 || m > TRAINING_MODULE_COUNT) {
    window.location.replace('/portal/training.html');
    return;
  }
  const content = TRAINING_CONTENT[m];
  const moduleUuid = TRAINING_MODULE_UUIDS[m];

  setText('moduleTitle', content.title);
  setText('moduleNum', `Module ${m} of ${TRAINING_MODULE_COUNT}`);
  const body = document.getElementById('moduleBody');
  if (body) {
    body.innerHTML = content.html;
    content.init?.();
  }

  // Prev/next links
  const nav = document.getElementById('moduleNav');
  if (nav) {
    nav.innerHTML = `
      ${m > 1 ? `<a href="/portal/training-module.html?m=${m - 1}" class="btn btn-secondary">← Module ${m - 1}</a>` : '<span></span>'}
      <a href="/portal/training.html" class="btn btn-secondary">All Modules</a>
      ${m < TRAINING_MODULE_COUNT ? `<a href="/portal/training-module.html?m=${m + 1}" class="btn btn-secondary">Module ${m + 1} →</a>` : '<span></span>'}
    `;
  }

  // Existing progress: mark in_progress on first visit, never downgrade
  // a completed module.
  const { data: existing } = await supabase
    .from('training_progress')
    .select('*')
    .eq('user_id', portalUser.id)
    .eq('module_id', moduleUuid)
    .maybeSingle();

  if (!existing) {
    await supabase.from('training_progress').insert({
      user_id: portalUser.id,
      module_id: moduleUuid,
      status: 'in_progress',
    });
  } else if (existing.status === 'completed') {
    const banner = document.getElementById('moduleCompletedBanner');
    if (banner) {
      banner.textContent = `You've already completed this module${Number.isFinite(existing.quiz_score) ? ` with a score of ${existing.quiz_score}%` : ''} — feel free to review or retake the quiz.`;
      banner.className = 'portal-alert portal-alert-success visible';
    }
  }

  await loadModuleQuiz(portalUser, m, moduleUuid);
  await logActivity('training_module_view', { module: m });
}

async function loadModuleQuiz(portalUser, m, moduleUuid) {
  const wrap = document.getElementById('quizWrap');
  if (!wrap) return;

  const { data: questions, error } = await supabase
    .from('training_quiz_questions')
    .select('*')
    .eq('module_id', moduleUuid)
    .order('order_index', { ascending: true });

  if (error || !questions?.length) {
    wrap.innerHTML = `<div class="portal-alert portal-alert-error visible" style="display:block;">
      Quiz unavailable — the training tables haven't been created yet.
      Run <code>supabase/subscription-model-schema.sql</code> in the Supabase SQL editor.
    </div>`;
    return;
  }

  renderQuiz(wrap, portalUser, m, moduleUuid, questions);
}

function renderQuiz(wrap, portalUser, m, moduleUuid, questions) {
  wrap.innerHTML = `
    <h2 class="quiz-heading">Knowledge Check <span>— ${questions.length} questions, ${TRAINING_PASS_MARK}% to pass</span></h2>
    <form id="quizForm" novalidate>
      ${questions.map((q, qi) => `
        <fieldset class="quiz-question">
          <legend>${qi + 1}. ${esc(q.question)}</legend>
          ${(Array.isArray(q.options) ? q.options : JSON.parse(q.options)).map((opt, oi) => `
            <label class="quiz-option">
              <input type="radio" name="q${qi}" value="${oi}" />
              <span>${esc(opt)}</span>
            </label>
          `).join('')}
        </fieldset>
      `).join('')}
      <div class="portal-alert" id="quizAlert"></div>
      <button type="submit" class="btn btn-primary" id="quizSubmitBtn">Submit Quiz</button>
    </form>
    <div id="quizResult"></div>
  `;

  const form = document.getElementById('quizForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('quizAlert');
    alertEl.classList.remove('visible');

    // All questions answered?
    for (let qi = 0; qi < questions.length; qi++) {
      if (!form.querySelector(`input[name="q${qi}"]:checked`)) {
        alertEl.textContent = `Please answer question ${qi + 1} before submitting.`;
        alertEl.className = 'portal-alert portal-alert-error visible';
        return;
      }
    }

    let correct = 0;
    questions.forEach((q, qi) => {
      const chosen = Number(form.querySelector(`input[name="q${qi}"]:checked`).value);
      if (chosen === q.correct_index) correct++;
    });
    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= TRAINING_PASS_MARK;

    const btn = document.getElementById('quizSubmitBtn');
    btn.disabled = true;

    const resultEl = document.getElementById('quizResult');

    if (!passed) {
      resultEl.innerHTML = `
        <div class="quiz-result quiz-result-fail">
          <h3>Score: ${score}% (${correct}/${questions.length})</h3>
          <p>You need ${TRAINING_PASS_MARK}% to pass. Review the lesson above and try again — there's no limit on retakes.</p>
          <button class="btn btn-primary" id="quizRetryBtn">Retake Quiz</button>
        </div>`;
      document.getElementById('quizRetryBtn').addEventListener('click', () => {
        renderQuiz(wrap, portalUser, m, moduleUuid, questions);
        wrap.scrollIntoView({ behavior: 'smooth' });
      });
      return;
    }

    // Passed — record completion.
    const { error: saveError } = await supabase.from('training_progress').upsert({
      user_id: portalUser.id,
      module_id: moduleUuid,
      status: 'completed',
      quiz_score: score,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,module_id' });

    if (saveError) {
      resultEl.innerHTML = `
        <div class="quiz-result quiz-result-fail">
          <h3>Score: ${score}% — passed, but we couldn't save your progress.</h3>
          <p>Please refresh and try again.</p>
        </div>`;
      btn.disabled = false;
      return;
    }

    await logActivity('training_module_completed', { module: m, score });

    // Certificate check — auto-"generated" when the 5th module completes.
    const { rows } = await fetchTrainingProgress(portalUser);
    const done = completedCount(rows);
    const allDone = done >= TRAINING_MODULE_COUNT;

    resultEl.innerHTML = `
      <div class="quiz-result quiz-result-pass">
        <h3>🎉 Passed — ${score}% (${correct}/${questions.length})</h3>
        <p>Module ${m} complete. ${allDone
          ? 'That was your final module — your Certificate of Completion is ready!'
          : `${done} of ${TRAINING_MODULE_COUNT} modules done.`}</p>
        ${allDone
          ? '<a href="/portal/certificate.html" class="btn btn-primary">View Your Certificate</a>'
          : (m < TRAINING_MODULE_COUNT
              ? `<a href="/portal/training-module.html?m=${m + 1}" class="btn btn-primary">Next: ${esc(TRAINING_CONTENT[m + 1].title)} →</a>`
              : '<a href="/portal/training.html" class="btn btn-primary">Back to Training</a>')}
      </div>`;
    resultEl.scrollIntoView({ behavior: 'smooth' });
  });
}

// ─── Certificate page (certificate.html) ─────────────────────────

async function initCertificatePage(portalUser) {
  const { rows, error } = await fetchTrainingProgress(portalUser);
  if (error || completedCount(rows) < TRAINING_MODULE_COUNT) {
    // Not earned yet — back to the training hub.
    window.location.replace('/portal/training.html');
    return;
  }

  const completionDates = rows
    .filter(r => r.status === 'completed' && r.completed_at)
    .map(r => new Date(r.completed_at).getTime());
  const completedOn = completionDates.length ? new Date(Math.max(...completionDates)) : new Date();

  setText('certName', portalUser.full_name);
  setText('certCompany', portalUser.company || '');
  setText('certDate', completedOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
  setText('certId', `P4-INTRO-${String(portalUser.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`);

  const scores = rows.filter(r => r.status === 'completed' && Number.isFinite(r.quiz_score));
  if (scores.length) {
    const avg = Math.round(scores.reduce((s, r) => s + r.quiz_score, 0) / scores.length);
    setText('certScore', `Average quiz score: ${avg}%`);
  }

  document.getElementById('printCertBtn')?.addEventListener('click', () => window.print());
  await logActivity('certificate_viewed');
}
