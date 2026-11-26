window.app = {
    state: {
        subjects: [],
        deletedIds: [],
        pendingCloudDeletes: [],
        pendingScoreSubmissions: [],
        weakQuestionsBySubject: {},
        activeQuizSession: null,
        studentName: "",
        theme: "light"
    },

    quiz: {
        subjectId: null,
        subjectTitle: "",
        allSubjectQuestions: [],
        currentQuestions: [],
        userHistory: [],
        currentIndex: 0,
        lastCorrectIndex: null,
        score: 0,
        correct: 0,
        wrong: 0,
        selectedOptionIndex: null,
        timerInterval: null,
        timeLeft: 45,
        elapsedSeconds: 0,
        isRetryMode: false
    },

    currentViewZone: 'student-zone',
    _isSyncing: false,
    _autoSyncInterval: null,
    _globalTimerInterval: null,
    _studentToastTimer: null,

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    escapeAttr(value) {
        return this.escapeHtml(value).replace(/`/g, '&#96;');
    },

    init() {
        this.loadFromStorage();
        this.state.deletedIds = Array.isArray(this.state.deletedIds) ? this.state.deletedIds : [];
        this.state.pendingCloudDeletes = Array.isArray(this.state.pendingCloudDeletes) ? this.state.pendingCloudDeletes : [];
        this.state.pendingScoreSubmissions = Array.isArray(this.state.pendingScoreSubmissions) ? this.state.pendingScoreSubmissions : [];
        this.state.weakQuestionsBySubject = (this.state.weakQuestionsBySubject && typeof this.state.weakQuestionsBySubject === 'object')
            ? this.state.weakQuestionsBySubject
            : {};
        this.pruneDeletedIds(200);
        this.filterOutDeletedSubjects();
        this.applyTheme();
        this.populateTopicFilter();
        this.renderDashboard();
        this.renderResumeBanner();
        this.initGlobalTimer();
        this.setupAutomaticSync();
        this.bindQuizEnterValidation();
    },

    isDeletedSubject(subjectId) {
        if (!subjectId) return false;
        return (this.state.deletedIds || []).includes(String(subjectId));
    },

    filterOutDeletedSubjects() {
        const deletedSet = new Set((this.state.deletedIds || []).map(String));
        this.state.subjects = (this.state.subjects || []).filter(s => !deletedSet.has(String(s.id)));
    },

    setupAutomaticSync() {
        const triggerSync = () => {
            if (navigator.onLine) {
                if (typeof this.flushPendingScoreSubmissions === 'function') {
                    this.flushPendingScoreSubmissions();
                }
                if (this.refreshSharedCoursesForStudent) {
                    this.refreshSharedCoursesForStudent(false);
                }
            }
        };

        triggerSync();

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                triggerSync();
            }
        });

        window.addEventListener("focus", triggerSync);
        window.addEventListener("online", triggerSync);

        if (this._autoSyncInterval) clearInterval(this._autoSyncInterval);
        this._autoSyncInterval = setInterval(() => {
            const isInQuiz = document.getElementById('view-quiz')?.classList.contains('active');
            if (document.visibilityState === "visible" && navigator.onLine && !isInQuiz) {
                this.refreshSharedCoursesForStudent(false);
            }
        }, 20000);
    },

    showStudentToast(message, isError = false) {
        let banner = document.getElementById('student-toast-banner');
        const host = document.querySelector('#view-dashboard .filter-bar');
        if (!banner && host && host.parentNode) {
            banner = document.createElement('div');
            banner.id = 'student-toast-banner';
            banner.className = 'status-toast';
            banner.setAttribute('role', 'status');
            banner.setAttribute('aria-live', 'polite');
            host.parentNode.insertBefore(banner, host);
        }
        if (!banner) return;
        banner.textContent = message;
        banner.classList.toggle('is-error', Boolean(isError));
        banner.classList.remove('hidden');
        clearTimeout(this._studentToastTimer);
        this._studentToastTimer = setTimeout(() => {
            banner.classList.add('hidden');
        }, 3800);
    },

    pruneDeletedIds(maxKeep = 200) {
        if (!Array.isArray(this.state.deletedIds)) {
            this.state.deletedIds = [];
            return;
        }
        const pendingSet = new Set((this.state.pendingCloudDeletes || []).map(String));
        if (this.state.deletedIds.length > maxKeep) {
            const unconfirmed = this.state.deletedIds.filter(id => pendingSet.has(String(id)));
            const confirmedTail = this.state.deletedIds
                .filter(id => !pendingSet.has(String(id)))
                .slice(-Math.max(0, maxKeep - unconfirmed.length));
            this.state.deletedIds = [...confirmedTail, ...unconfirmed];
        }
    },

    bindQuizEnterValidation() {
        if (this._quizEnterBound) return;
        this._quizEnterBound = true;
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            const quizView = document.getElementById('view-quiz');
            const nameModal = document.getElementById('student-name-modal');
            const editorModal = document.getElementById('editor-code-modal');
            const isModalOpen =
                (nameModal && !nameModal.classList.contains('hidden')) ||
                (editorModal && !editorModal.classList.contains('hidden'));
            if (isModalOpen) return;
            if (quizView && quizView.classList.contains('active')) {
                const activeTag = document.activeElement?.tagName?.toLowerCase();
                if (activeTag !== 'button') {
                    event.preventDefault();
                    const now = Date.now();
                    if (now - (this._lastEnterValidateAt || 0) > 450) {
                        this._lastEnterValidateAt = now;
                        this.validateAnswer();
                    }
                }
            }
        });
    },

    saveToStorage() {
        try {
            localStorage.setItem('smart_composition_v3', JSON.stringify(this.state));
        } catch (e) {}
    },

    loadFromStorage() {
        try {
            const raw = localStorage.getItem('smart_composition_v3') || localStorage.getItem('smart_composition_v2');
            if (raw) {
                const parsed = JSON.parse(raw);
                this.state = {
                    ...this.state,
                    ...parsed,
                    deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
                    pendingCloudDeletes: Array.isArray(parsed.pendingCloudDeletes) ? parsed.pendingCloudDeletes : [],
                    pendingScoreSubmissions: Array.isArray(parsed.pendingScoreSubmissions) ? parsed.pendingScoreSubmissions : [],
                    weakQuestionsBySubject: (parsed.weakQuestionsBySubject && typeof parsed.weakQuestionsBySubject === 'object')
                        ? parsed.weakQuestionsBySubject
                        : {}
                };
            }
        } catch (e) {}
    },

    toggleDarkThemeQuick() {
        const currentAttr = document.documentElement.getAttribute('data-theme');
        const current = currentAttr || this.state.theme || "light";
        const nextMode = current === "dark" ? "light" : "dark";
        this.state.theme = nextMode;
        this.applyTheme();
        this.saveToStorage();
    },

    applyTheme() {
        const mode = this.state.theme === "dark" ? "dark" : "light";
        document.documentElement.setAttribute('data-theme', mode);
        document.documentElement.style.colorScheme = mode;
        if (document.body) {
            document.body.setAttribute('data-theme', mode);
        }
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) {
            btn.textContent = mode === "dark" ? "☀️" : "🌙";
        }
    },

    goHome() {
        clearInterval(this.quiz.timerInterval);
        this.quiz.selectedOptionIndex = null;
        this.saveActiveQuizSession();
        if (this.currentViewZone === 'editor-zone') {
            this.switchView('editor-dashboard');
        } else {
            this.switchView('dashboard');
            this.renderResumeBanner();
            if (this.refreshSharedCoursesForStudent) {
                this.refreshSharedCoursesForStudent(false);
            }
        }
    },

    switchView(viewId) {
        const activeZone = document.getElementById(this.currentViewZone);
        if (!activeZone) return;

        activeZone.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) targetView.classList.add('active');

        if (targetView) {
            targetView.scrollTop = 0;
            targetView.querySelectorAll('.grid-courses, .leaderboard-scroll, #correction-drawer, .quiz-question-card, .list-editor-management, #course-form').forEach(el => {
                el.scrollTop = 0;
            });
        }
        if (viewId === 'dashboard') {
            this.populateTopicFilter();
            this.renderDashboard();
        }
    },

    extractQuestionsFromSubject(subject) {
        const rawList = Array.isArray(subject.questions) && subject.questions.length > 0
            ? subject.questions
            : (() => {
                const extracted = [];
                (subject.chapters || []).forEach(ch => {
                    (ch.parts || []).forEach(pt => {
                        if (Array.isArray(pt.questions)) {
                            extracted.push(...pt.questions);
                        }
                    });
                });
                return extracted;
            })();

        return rawList.map((q, idx) => ({
            ...q,
            _qid: String(q._qid || q.id || `q_${idx}_${(q.question || '').slice(0, 24)}`),
            topic: String(q.topic || subject.topic || "Général").trim() || "Général",
            keyTakeaway: String(q.keyTakeaway || q.synthesis || "").trim()
        }));
    },

    populateTopicFilter() {
        const select = document.getElementById('filter-topic-select');
        if (!select) return;
        const currentVal = select.value;
        const topics = Array.from(new Set(
            (this.state.subjects || [])
                .map(s => String(s.topic || "").trim())
                .filter(Boolean)
        )).sort((a, b) => a.localeCompare(b, 'fr'));

        select.innerHTML = '<option value="">Toutes les matières</option>';
        topics.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            select.appendChild(opt);
        });
        if (topics.includes(currentVal)) {
            select.value = currentVal;
        }
    },

    renderDashboard() {
        this.filterOutDeletedSubjects();
        const container = document.getElementById('courses-list');
        if (!container) return;
        container.innerHTML = '';

        const searchQ = (document.getElementById('filter-search-input')?.value || "").trim().toLowerCase();
        const selectedTopic = (document.getElementById('filter-topic-select')?.value || "").trim();

        const filtered = (this.state.subjects || []).filter(subj => {
            const topic = String(subj.topic || "").trim();
            const matchesTopic = !selectedTopic || topic === selectedTopic;
            const matchesSearch = !searchQ ||
                String(subj.title || "").toLowerCase().includes(searchQ) ||
                topic.toLowerCase().includes(searchQ);
            return matchesTopic && matchesSearch;
        });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="course-card" style="text-align:center;">
                    <p style="font-weight:700;">Aucun sujet disponible pour le moment.</p>
                    <p class="text-muted">Les sujets apparaîtront automatiquement dès leur publication.</p>
                </div>`;
            return;
        }

        const visibleCards = filtered;
        visibleCards.forEach(subj => {
            const questions = this.extractQuestionsFromSubject(subj);
            const weakIds = this.state.weakQuestionsBySubject[String(subj.id)] || [];
            const topicLabel = subj.topic ? `<span class="tag-pill">${this.escapeHtml(subj.topic)}</span>` : '';
            const weakBadge = weakIds.length > 0
                ? `<span class="tag-pill warn">🔁 ${weakIds.length} à revoir</span>`
                : '';
            const synthesisHtml = subj.synthesis
                ? `<div class="synthesis-box"><strong>Synthèse :</strong> ${this.escapeHtml(subj.synthesis)}</div>`
                : '';

            const card = document.createElement('div');
            card.className = 'course-card';
            card.innerHTML = `
                <div>
                    <h3 style="font-weight:800; font-size:1.08rem;">${this.escapeHtml(subj.title)}</h3>
                    <div class="course-tags">
                        ${topicLabel}
                        <span class="tag-pill">${questions.length} question(s)</span>
                        ${weakBadge}
                    </div>
                </div>
                ${synthesisHtml}
                <button class="btn-compose-main">✍️ Composer</button>
            `;
            card.querySelector('.btn-compose-main').onclick = () => this.prepareSubjectAndAskName(subj.id);
            container.appendChild(card);
        });
    },

    prepareSubjectAndAskName(subjectId) {
        if (this.isDeletedSubject(subjectId)) return;
        const subj = this.state.subjects.find(s => String(s.id) === String(subjectId));
        if (!subj) return;

        const questions = this.extractQuestionsFromSubject(subj);
        if (questions.length === 0) {
            this.showStudentToast("Ce sujet ne contient pas encore de questions.", true);
            return;
        }

        this.quiz.subjectId = subj.id;
        this.quiz.subjectTitle = subj.title;
        this.quiz.allSubjectQuestions = questions;

        const modal = document.getElementById('student-name-modal');
        const input = document.getElementById('student-name-input');
        const err = document.getElementById('student-name-error');
        if (!modal || !input) return;
        if (err) err.classList.add('hidden');
        input.value = this.state.studentName || "";
        modal.classList.remove('hidden');
        input.focus();
    },

    closeStudentNameModal() {
        document.getElementById('student-name-modal').classList.add('hidden');
    },

    confirmStudentNameAndStart() {
        const input = document.getElementById('student-name-input');
        const err = document.getElementById('student-name-error');
        if (!input) return;
        const name = input.value.trim();

        if (name.length < 2) {
            if (err) {
                err.textContent = "Entre ton nom complet (au moins 2 caractères).";
                err.classList.remove('hidden');
            }
            return;
        }

        this.state.studentName = name;
        this.saveToStorage();
        this.closeStudentNameModal();

        const weakSet = new Set((this.state.weakQuestionsBySubject[String(this.quiz.subjectId)] || []).map(String));
        const weakList = this.shuffleArray(this.quiz.allSubjectQuestions.filter(q => weakSet.has(String(q._qid))));
        const normalList = this.shuffleArray(this.quiz.allSubjectQuestions.filter(q => !weakSet.has(String(q._qid))));
        const ordered = [...weakList, ...normalList];

        this.startQuiz(ordered, false);
    },


    saveActiveQuizSession() {
        const quizView = document.getElementById('view-quiz');
        const inProgress = quizView && quizView.classList.contains('active') && Array.isArray(this.quiz.currentQuestions) && this.quiz.currentQuestions.length > 0;
        if (!inProgress) return;
        this.state.activeQuizSession = {
            savedAt: Date.now(),
            studentName: this.state.studentName || "",
            subjectId: this.quiz.subjectId,
            subjectTitle: this.quiz.subjectTitle,
            currentQuestions: this.quiz.currentQuestions,
            userHistory: this.quiz.userHistory || [],
            currentIndex: this.quiz.currentIndex || 0,
            lastCorrectIndex: this.quiz.lastCorrectIndex,
            score: this.quiz.score || 0,
            correct: this.quiz.correct || 0,
            wrong: this.quiz.wrong || 0,
            selectedOptionIndex: typeof this.quiz.selectedOptionIndex === 'number' ? this.quiz.selectedOptionIndex : null,
            timeLeft: typeof this.quiz.timeLeft === 'number' ? this.quiz.timeLeft : 45,
            questionSavedAt: Date.now(),
            elapsedSeconds: this.quiz.elapsedSeconds || 0,
            isRetryMode: Boolean(this.quiz.isRetryMode)
        };
        this.saveToStorage();
    },

    clearActiveQuizSession() {
        this.state.activeQuizSession = null;
        this.saveToStorage();
        this.renderResumeBanner();
    },

    discardSavedQuiz() {
        this.clearActiveQuizSession();
    },

    renderResumeBanner() {
        const banner = document.getElementById('resume-session-banner');
        const titleEl = document.getElementById('resume-session-title');
        const metaEl = document.getElementById('resume-session-meta');
        if (!banner) return;

        const sess = this.state.activeQuizSession;
        const exists = sess && Array.isArray(sess.currentQuestions) && sess.currentQuestions.length > 0 && sess.currentIndex < sess.currentQuestions.length;
        const stillHasSubject = exists && (this.state.subjects || []).some(s => String(s.id) === String(sess.subjectId) && !this.isDeletedSubject(s.id));

        if (!exists || !stillHasSubject) {
            if (sess && !stillHasSubject) {
                this.state.activeQuizSession = null;
                this.saveToStorage();
            }
            banner.classList.add('hidden');
            return;
        }

        const qNum = Math.min((sess.currentIndex || 0) + 1, sess.currentQuestions.length);
        const mins = Math.floor((sess.elapsedSeconds || 0) / 60).toString().padStart(2, '0');
        const secs = ((sess.elapsedSeconds || 0) % 60).toString().padStart(2, '0');
        if (titleEl) titleEl.textContent = sess.subjectTitle || "Composition en pause";
        if (metaEl) metaEl.textContent = `Question ${qNum}/${sess.currentQuestions.length} • ${mins}:${secs}`;
        banner.classList.remove('hidden');
    },

    resumeSavedQuiz() {
        const sess = this.state.activeQuizSession;
        if (!sess || !Array.isArray(sess.currentQuestions) || sess.currentQuestions.length === 0) {
            this.renderResumeBanner();
            return;
        }
        if (sess.studentName) {
            this.state.studentName = sess.studentName;
            this.saveToStorage();
        }
        this.quiz.subjectId = sess.subjectId;
        this.quiz.subjectTitle = sess.subjectTitle || "Composition";
        this.quiz.allSubjectQuestions = this.quiz.allSubjectQuestions && this.quiz.allSubjectQuestions.length > 0
            ? this.quiz.allSubjectQuestions
            : sess.currentQuestions;
        this.quiz.currentQuestions = sess.currentQuestions;
        this.quiz.userHistory = Array.isArray(sess.userHistory) ? sess.userHistory : [];
        this.quiz.currentIndex = Math.min(sess.currentIndex || 0, sess.currentQuestions.length - 1);
        this.quiz.lastCorrectIndex = sess.lastCorrectIndex ?? null;
        this.quiz.score = sess.score || 0;
        this.quiz.correct = sess.correct || 0;
        this.quiz.wrong = sess.wrong || 0;
        this.quiz.elapsedSeconds = sess.elapsedSeconds || 0;
        this.quiz.isRetryMode = Boolean(sess.isRetryMode);
        let baseTimeLeft = (typeof sess.timeLeft === 'number' && sess.timeLeft > 0 && sess.timeLeft <= 45)
            ? sess.timeLeft
            : 45;
        if (typeof sess.questionSavedAt === 'number' && sess.questionSavedAt > 0) {
            const awaySec = Math.max(0, Math.floor((Date.now() - sess.questionSavedAt) / 1000));
            baseTimeLeft = Math.max(1, baseTimeLeft - awaySec);
        }
        const restoredTimeLeft = baseTimeLeft;

        document.getElementById('quiz-participant-name').innerText = this.state.studentName || "Candidat";
        document.getElementById('quiz-subject-subtitle').innerText = this.quiz.subjectTitle;
        const mins = Math.floor(this.quiz.elapsedSeconds / 60).toString().padStart(2, '0');
        const secs = (this.quiz.elapsedSeconds % 60).toString().padStart(2, '0');
        document.getElementById('quiz-elapsed-timer').innerText = `${mins}:${secs}`;

        this.switchView('quiz');
        this.showQuestion(restoredTimeLeft, true);
        if (typeof sess.selectedOptionIndex === 'number' && sess.selectedOptionIndex >= 0) {
            const optionButtons = document.querySelectorAll('#quiz-options-container .option-item');
            const targetBtn = optionButtons[sess.selectedOptionIndex];
            if (targetBtn) {
                this.selectOption(sess.selectedOptionIndex, targetBtn);
            }
        }
        this.saveActiveQuizSession();
    },

    shuffleArray(arr) {
        const copy = Array.isArray(arr) ? [...arr] : [];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    },

    shuffleOptionsAvoidRepeatSlot(options, currentCorrectIndex, forbiddenIndex) {
        const cleanOptions = options.map(o => String(o || "").trim());
        const n = cleanOptions.length;
        const correctValue = cleanOptions[currentCorrectIndex];
        let indices = cleanOptions.map((_, i) => i);

        for (let attempt = 0; attempt < 25; attempt++) {
            indices = this.shuffleArray(cleanOptions.map((_, i) => i));
            const newPos = indices.indexOf(currentCorrectIndex);
            if (n <= 1 || forbiddenIndex === null || forbiddenIndex === undefined || newPos !== forbiddenIndex) {
                break;
            }
        }

        const shuffledOptions = indices.map(i => cleanOptions[i]);
        let newAnswerIndex = shuffledOptions.indexOf(correctValue);

        if (n > 1 && forbiddenIndex !== null && forbiddenIndex !== undefined && newAnswerIndex === forbiddenIndex) {
            const swapIdx = (forbiddenIndex + 1) % n;
            const temp = shuffledOptions[forbiddenIndex];
            shuffledOptions[forbiddenIndex] = shuffledOptions[swapIdx];
            shuffledOptions[swapIdx] = temp;
            newAnswerIndex = swapIdx;
        }

        return {
            options: shuffledOptions,
            answer: newAnswerIndex
        };
    },

    prepareQuestionForDisplay(question, forbiddenIndex) {
        const baseOptions = Array.isArray(question.options) ? question.options : [];
        const safeAnsIdx = (typeof question.answer === 'number' && question.answer >= 0 && question.answer < baseOptions.length)
            ? question.answer
            : 0;
        const correctRaw = String(baseOptions[safeAnsIdx] || "").trim();

        const shuffled = this.shuffleOptionsAvoidRepeatSlot(baseOptions, safeAnsIdx, forbiddenIndex);
        const finalAnsIdx = shuffled.options.indexOf(correctRaw);

        return {
            ...question,
            options: shuffled.options,
            answer: finalAnsIdx >= 0 ? finalAnsIdx : shuffled.answer
        };
    },

    startQuiz(questionsList, isRetry = false) {
        this.quiz.currentQuestions = questionsList;
        this.quiz.isRetryMode = isRetry;
        this.quiz.userHistory = [];
        this.quiz.currentIndex = 0;
        this.quiz.lastCorrectIndex = null;
        this.quiz.score = 0;
        this.quiz.correct = 0;
        this.quiz.wrong = 0;
        this.quiz.elapsedSeconds = 0;

        document.getElementById('quiz-participant-name').innerText = this.state.studentName;
        document.getElementById('quiz-subject-subtitle').innerText = this.quiz.subjectTitle;
        document.getElementById('quiz-elapsed-timer').innerText = "00:00";

        this.switchView('quiz');
        this.showQuestion();
    },

    showQuestion(customTimeLeft = null, skipReshuffle = false) {
        const rawQuestion = this.quiz.currentQuestions[this.quiz.currentIndex];
        const question = skipReshuffle
            ? rawQuestion
            : this.prepareQuestionForDisplay(rawQuestion, this.quiz.lastCorrectIndex);
        this.quiz.currentQuestions[this.quiz.currentIndex] = question;
        this.quiz.lastCorrectIndex = question.answer;

        const total = this.quiz.currentQuestions.length;

        document.getElementById('quiz-question-number').innerText = this.quiz.isRetryMode
            ? `Erreur ${this.quiz.currentIndex + 1} / ${total}`
            : `Question ${this.quiz.currentIndex + 1} / ${total}`;
        document.getElementById('quiz-question-text').innerText = question.question;

        const topicEl = document.getElementById('quiz-current-topic');
        if (topicEl) topicEl.innerText = question.topic || "Général";

        document.getElementById('quiz-progress-line').style.width = `${((this.quiz.currentIndex + 1) / total) * 100}%`;

        this._isValidatingAnswer = false;
        const validateBtn = document.getElementById('btn-validate-quiz');
        if (validateBtn) validateBtn.disabled = false;
        this.quiz.timeLeft = (typeof customTimeLeft === 'number' && customTimeLeft > 0) ? customTimeLeft : 45;
        document.getElementById('question-timer-val').innerText = `${this.quiz.timeLeft}s`;

        clearInterval(this.quiz.timerInterval);
        this.quiz.timerInterval = setInterval(() => {
            this.quiz.timeLeft--;
            document.getElementById('question-timer-val').innerText = `${this.quiz.timeLeft}s`;
            if (this.quiz.timeLeft <= 0) {
                clearInterval(this.quiz.timerInterval);
                this.validateAnswer(true);
            }
        }, 1000);

        const container = document.getElementById('quiz-options-container');
        container.innerHTML = '';
        this.quiz.selectedOptionIndex = null;

        const letters = ['A', 'B', 'C', 'D', 'E'];
        question.options.forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.className = 'option-item';
            btn.innerHTML = `
                <span class="option-letter">${letters[idx] || idx + 1}</span>
                <span class="option-string">${this.escapeHtml(opt)}</span>
            `;
            btn.onclick = () => this.selectOption(idx, btn);
            container.appendChild(btn);
        });
    },

    selectOption(index, element) {
        this.quiz.selectedOptionIndex = index;
        document.querySelectorAll('.option-item').forEach(item => item.classList.remove('selected'));
        element.classList.add('selected');
        this.saveActiveQuizSession();
    },

    validateAnswer(forcedTimeout = false) {
        if (this._isValidatingAnswer && !forcedTimeout) return;
        clearInterval(this.quiz.timerInterval);

        if (this.quiz.selectedOptionIndex === null && !forcedTimeout) {
            const qCard = document.querySelector('.quiz-question-card');
            if (qCard) {
                let qErr = document.getElementById('quiz-inline-error');
                if (!qErr) {
                    qErr = document.createElement('p');
                    qErr.id = 'quiz-inline-error';
                    qErr.style.cssText = "color:var(--bad); font-size:0.88rem; font-weight:700; margin-top:2px;";
                    qCard.appendChild(qErr);
                }
                qErr.textContent = "Choisis une proposition avant de valider.";
            }
            return;
        }
        const existingQErr = document.getElementById('quiz-inline-error');
        if (existingQErr) existingQErr.textContent = "";

        const question = this.quiz.currentQuestions[this.quiz.currentIndex];
        const isCorrect = !forcedTimeout && (this.quiz.selectedOptionIndex === question.answer);

        this.quiz.userHistory.push({
            questionObj: question,
            chosenIndex: forcedTimeout ? -1 : this.quiz.selectedOptionIndex,
            isCorrect: isCorrect
        });

        this._isValidatingAnswer = true;
        const validateBtn = document.getElementById('btn-validate-quiz');
        if (validateBtn) validateBtn.disabled = true;

        if (isCorrect) {
            this.quiz.correct++;
            this.quiz.score += 20;
        } else {
            this.quiz.wrong++;
        }

        this.saveActiveQuizSession();
        this.nextStep();
    },

    nextStep() {
        this.quiz.currentIndex++;
        if (this.quiz.currentIndex < this.quiz.currentQuestions.length) {
            this.showQuestion();
        } else {
            clearInterval(this.quiz.timerInterval);
            this.finishComposition();
        }
    },

    updateSpacedMemory() {
        const subjKey = String(this.quiz.subjectId || "");
        if (!subjKey) return;

        const existing = new Set((this.state.weakQuestionsBySubject[subjKey] || []).map(String));
        this.quiz.userHistory.forEach(item => {
            const qid = String(item.questionObj._qid || "");
            if (!qid) return;
            if (item.isCorrect) {
                existing.delete(qid);
            } else {
                existing.add(qid);
            }
        });

        this.state.weakQuestionsBySubject[subjKey] = Array.from(existing);
        this.saveToStorage();
    },

    getEncouragementPhrase(grade) {
        if (grade >= 18) return "Excellente maîtrise sur l'ensemble du sujet.";
        if (grade >= 15) return "Très bon niveau. Quelques détails suffisent pour viser le sommet.";
        if (grade >= 12) return "Bon résultat. Parcours la correction pour renforcer les points clés.";
        if (grade >= 10) return "Moyenne atteinte. Reprends les erreurs pour consolider.";
        return "Reprends les questions ratées pour ancrer les notions essentielles.";
    },

    async finishComposition() {
        const total = this.quiz.currentQuestions.length;
        const grade = total > 0 ? Number(((this.quiz.correct / total) * 20).toFixed(2)) : 0;

        this.updateSpacedMemory();

        const resNameEl = document.getElementById('res-student-name');
        const resGradeEl = document.getElementById('res-grade');
        const resCountsEl = document.getElementById('res-summary-counts');
        const resEncEl = document.getElementById('res-encouragement');
        if (resNameEl) resNameEl.innerText = this.state.studentName;
        if (resGradeEl) resGradeEl.innerText = grade.toFixed(1);
        if (resCountsEl) resCountsEl.innerText = `${this.quiz.correct} / ${total} bonnes réponses`;
        if (resEncEl) resEncEl.innerText = this.getEncouragementPhrase(grade);

        const wrongItems = this.quiz.userHistory.filter(h => !h.isCorrect);
        const retryBtn = document.getElementById('btn-retry-wrong');
        const wrongCountEl = document.getElementById('wrong-count-btn');
        if (retryBtn) {
            if (wrongItems.length > 0) {
                retryBtn.classList.remove('hidden');
                if (wrongCountEl) wrongCountEl.innerText = wrongItems.length;
            } else {
                retryBtn.classList.add('hidden');
            }
        }

        this.clearActiveQuizSession();
        this.renderTopicBreakdown();
        this.resetCorrectionVisibility();
        this.renderCorrectionGrid();
        this.switchView('results');

        if (!this.quiz.isRetryMode) {
            await this.submitScoreToLeaderboard(grade, this.quiz.correct, total, this.quiz.elapsedSeconds);
        }
        await this.loadLeaderboard(this.quiz.subjectId);
    },

    renderTopicBreakdown() {
        const container = document.getElementById('topic-breakdown-container');
        const reviewBox = document.getElementById('spaced-review-box');
        if (!container) return;

        const stats = {};
        this.quiz.userHistory.forEach(item => {
            const topic = item.questionObj.topic || "Général";
            if (!stats[topic]) stats[topic] = { total: 0, correct: 0 };
            stats[topic].total++;
            if (item.isCorrect) stats[topic].correct++;
        });

        container.innerHTML = '';
        Object.entries(stats).forEach(([topic, st]) => {
            const row = document.createElement('div');
            row.className = 'topic-row';
            row.innerHTML = `
                <span>${this.escapeHtml(topic)}</span>
                <span>${st.correct} / ${st.total}</span>
            `;
            container.appendChild(row);
        });

        const weakCount = (this.state.weakQuestionsBySubject[String(this.quiz.subjectId)] || []).length;
        if (reviewBox) {
            if (weakCount > 0) {
                reviewBox.classList.remove('hidden');
                reviewBox.innerText = `${weakCount} question(s) à revoir prioritairement lors de la prochaine session.`;
            } else {
                reviewBox.classList.add('hidden');
            }
        }
    },

    resetCorrectionVisibility() {
        const drawer = document.getElementById('correction-drawer');
        const lbCard = document.getElementById('leaderboard-card');
        const btn = document.getElementById('btn-toggle-correction');
        const label = document.getElementById('correction-toggle-label');
        if (drawer) drawer.classList.add('hidden');
        if (lbCard) lbCard.classList.remove('hidden');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        if (label) label.textContent = 'Correction détaillée';
    },

    toggleCorrectionDetails() {
        const drawer = document.getElementById('correction-drawer');
        const lbCard = document.getElementById('leaderboard-card');
        const grid = document.getElementById('correction-grid-container');
        const btn = document.getElementById('btn-toggle-correction');
        const label = document.getElementById('correction-toggle-label');
        if (!drawer) return;

        const isHidden = drawer.classList.contains('hidden');
        if (isHidden) {
            if (!grid || !grid.children.length) {
                this.renderCorrectionGrid();
            }
            drawer.classList.remove('hidden');
            drawer.classList.add('correction-active');
            if (lbCard) lbCard.classList.add('hidden');
            if (btn) btn.setAttribute('aria-expanded', 'true');
            if (label) label.textContent = 'Voir classement';
            drawer.scrollTop = 0;
        } else {
            drawer.classList.add('hidden');
            drawer.classList.remove('correction-active');
            if (lbCard) lbCard.classList.remove('hidden');
            if (btn) btn.setAttribute('aria-expanded', 'false');
            if (label) label.textContent = 'Correction détaillée';
        }
    },

    renderCorrectionGrid() {
        const container = document.getElementById('correction-grid-container');
        container.innerHTML = '';

        this.quiz.userHistory.forEach((item, idx) => {
            const q = item.questionObj;
            const userChoice = item.chosenIndex === -1 ? "Temps écoulé" : q.options[item.chosenIndex];
            const goodChoice = q.options[q.answer];
            const expText = (q.explanation || "").trim();
            const keyText = (q.keyTakeaway || "").trim();
            const showKey = keyText && keyText.toLowerCase() !== expText.toLowerCase();

            const card = document.createElement('div');
            card.className = `correction-item ${item.isCorrect ? 'is-correct' : 'is-wrong'}`;
            card.innerHTML = `
                <div class="correction-item-header">
                    <span>Q${idx + 1} • ${this.escapeHtml(q.topic || 'Général')}</span>
                    <span>${item.isCorrect ? '✅ Juste' : '❌ Faux'}</span>
                </div>
                <p class="correction-q">${this.escapeHtml(q.question)}</p>
                <p class="correction-ans"><strong>Ta réponse :</strong> ${this.escapeHtml(userChoice)}</p>
                ${!item.isCorrect ? `<p class="correction-good"><strong>Bonne réponse :</strong> ${this.escapeHtml(goodChoice)}</p>` : ''}
                ${expText ? `<p class="correction-exp"><strong>Explication :</strong> ${this.escapeHtml(expText)}</p>` : ''}
                ${showKey ? `<p class="correction-key"><strong>À retenir :</strong> ${this.escapeHtml(keyText)}</p>` : ''}
            `;
            container.appendChild(card);
        });
    },

    retryWrongQuestions() {
        const wrongQuestions = this.quiz.userHistory
            .filter(h => !h.isCorrect)
            .map(h => h.questionObj)
            ;
        if (wrongQuestions.length === 0) return;
        this.startQuiz(wrongQuestions, true);
    },

    queuePendingScoreSubmission(payload) {
        const list = Array.isArray(this.state.pendingScoreSubmissions) ? this.state.pendingScoreSubmissions : [];
        const duplicate = list.some(item =>
            String(item.courseId) === String(payload.courseId) &&
            String(item.name) === String(payload.name) &&
            Number(item.grade) === Number(payload.grade) &&
            Number(item.timeSec) === Number(payload.timeSec)
        );
        if (!duplicate) {
            this.state.pendingScoreSubmissions = [...list, payload];
            this.saveToStorage();
        }
    },

    async flushPendingScoreSubmissions() {
        const pending = Array.isArray(this.state.pendingScoreSubmissions) ? this.state.pendingScoreSubmissions : [];
        if (!this.TEAM_API_URL || pending.length === 0) return;

        const remaining = [];
        for (const item of pending) {
            try {
                const res = await fetch(this.TEAM_API_URL, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(item)
                });
                if (!res.ok) {
                    remaining.push(item);
                }
            } catch (e) {
                remaining.push(item);
            }
        }
        this.state.pendingScoreSubmissions = remaining;
        this.saveToStorage();
    },

    async submitScoreToLeaderboard(grade, correct, total, timeSec) {
        if (!this.TEAM_API_URL) return;
        const payload = {
            action: "submitScore",
            courseId: String(this.quiz.subjectId),
            name: this.state.studentName,
            grade: Number(grade),
            correct: Number(correct),
            total: Number(total),
            timeSec: Number(timeSec)
        };
        try {
            const res = await fetch(this.TEAM_API_URL, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                this.queuePendingScoreSubmission(payload);
            }
        } catch (e) {
            this.queuePendingScoreSubmission(payload);
        }
    },

    async loadLeaderboard(subjectId) {
        const container = document.getElementById('leaderboard-container');
        if (!container || !this.TEAM_API_URL) return;

        container.innerHTML = '<p class="text-muted">Chargement du classement...</p>';
        try {
            const res = await fetch(`${this.TEAM_API_URL}?action=leaderboard&courseId=${encodeURIComponent(String(subjectId))}&_t=${Date.now()}`, {
                cache: "no-store"
            });
            if (!res.ok) throw new Error("HTTP_" + res.status);
            const data = await res.json();
            const list = Array.isArray(data?.leaderboard) ? data.leaderboard : [];

            if (list.length === 0) {
                container.innerHTML = '<p class="text-muted">Aucun résultat enregistré pour ce sujet.</p>';
                return;
            }

            container.innerHTML = '';
            list.forEach((entry, idx) => {
                const rank = idx + 1;
                const medal = rank === 1 ? "🥇 1er" : rank === 2 ? "🥈 2e" : rank === 3 ? "🥉 3e" : `${rank}e`;
                const isMe = String(entry.name || "").toLowerCase() === (this.state.studentName || "").toLowerCase();

                const row = document.createElement('div');
                row.className = `leaderboard-row ${isMe ? 'is-me' : ''}`;
                row.innerHTML = `
                    <div class="lb-rank">${medal}</div>
                    <div class="lb-name">${this.escapeHtml(entry.name)} ${isMe ? '(Toi)' : ''}</div>
                    <div class="lb-grade">${Number(entry.grade).toFixed(1)}/20</div>
                `;
                container.appendChild(row);
            });
        } catch (e) {
            container.innerHTML = '<p style="color:var(--bad);">Impossible de charger le classement.</p>';
        }
    },

    downloadSubject() {
        const subj = this.state.subjects.find(s => String(s.id) === String(this.quiz.subjectId));
        if (!subj) return;

        const questions = this.extractQuestionsFromSubject(subj);
        const letters = ['A', 'B', 'C', 'D', 'E'];
        const gradeText = document.getElementById('res-grade')?.innerText || "0.0";
        const baseSlug = String(subj.title || "Composition").replace(/[^a-zA-Z0-9_-]+/g, '_');
        const safeFilename = `Sujet_${baseSlug}.pdf`;

        const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
        if (jsPDFCtor) {
            const doc = new jsPDFCtor({ unit: "pt", format: "a4" });
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 42;
            const maxWidth = pageWidth - margin * 2;
            let y = 48;

            const ensureSpace = (needed) => {
                if (y + needed > pageHeight - 40) {
                    doc.addPage();
                    y = 48;
                }
            };

            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(36, 77, 59);
            const titleLines = doc.splitTextToSize(String(subj.title || "Sujet de composition"), maxWidth);
            doc.text(titleLines, margin, y);
            y += titleLines.length * 20 + 6;

            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(24, 38, 32);
            const metaLine = `Candidat : ${this.state.studentName || "Étudiant"}  |  Matière : ${subj.topic || "Général"}  |  Note : ${gradeText}/20  |  Date : ${new Date().toLocaleDateString("fr-FR")}`;
            const metaLines = doc.splitTextToSize(metaLine, maxWidth);
            doc.text(metaLines, margin, y);
            y += metaLines.length * 14 + 10;

            if (subj.synthesis) {
                ensureSpace(34);
                doc.setFont("helvetica", "bold");
                doc.text("Synthèse :", margin, y);
                doc.setFont("helvetica", "normal");
                const synthLines = doc.splitTextToSize(String(subj.synthesis), maxWidth - 56);
                doc.text(synthLines, margin + 56, y);
                y += synthLines.length * 14 + 14;
            }

            questions.forEach((q, idx) => {
                ensureSpace(64);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(11);
                doc.setTextColor(24, 38, 32);
                const qLines = doc.splitTextToSize(`Question ${idx + 1} (${q.topic || "Général"}) : ${q.question}`, maxWidth);
                doc.text(qLines, margin, y);
                y += qLines.length * 15 + 4;

                doc.setFontSize(10);
                (q.options || []).forEach((opt, i) => {
                    ensureSpace(18);
                    const isGood = i === q.answer;
                    doc.setFont("helvetica", isGood ? "bold" : "normal");
                    doc.setTextColor(isGood ? 37 : 24, isGood ? 92 : 38, isGood ? 67 : 32);
                    const optLines = doc.splitTextToSize(`  ${letters[i] || i + 1}. ${opt}${isGood ? " (Bonne réponse)" : ""}`, maxWidth - 10);
                    doc.text(optLines, margin + 8, y);
                    y += optLines.length * 14 + 2;
                });

                if (q.explanation) {
                    ensureSpace(22);
                    doc.setFont("helvetica", "italic");
                    doc.setFontSize(9.5);
                    doc.setTextColor(92, 107, 99);
                    const expLines = doc.splitTextToSize(`Correction : ${q.explanation}`, maxWidth - 10);
                    doc.text(expLines, margin + 8, y);
                    y += expLines.length * 13 + 6;
                }

                y += 10;
            });

            doc.save(safeFilename);
            return;
        }

        const plainText = [
            subj.title || "Sujet de composition",
            `Candidat : ${this.state.studentName || "Étudiant"} | Matière : ${subj.topic || "Général"} | Note : ${gradeText}/20`,
            subj.synthesis ? `Synthèse : ${subj.synthesis}` : "",
            ...questions.map((q, idx) => [
                `Question ${idx + 1} (${q.topic || "Général"}) : ${q.question}`,
                ...(q.options || []).map((o, i) => `  ${letters[i] || i + 1}. ${o}${i === q.answer ? " [Bonne réponse]" : ""}`),
                q.explanation ? `  Correction : ${q.explanation}` : ""
            ].filter(Boolean).join("\n"))
        ].filter(Boolean).join("\n\n");

        const blob = new Blob([plainText], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Sujet_${baseSlug}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    },

    initGlobalTimer() {
        if (this._globalTimerInterval) clearInterval(this._globalTimerInterval);
        this._globalTimerInterval = setInterval(() => {
            const quizTimerView = document.getElementById('quiz-elapsed-timer');
            const quizView = document.getElementById('view-quiz');
            if (quizTimerView && quizView && quizView.classList.contains('active')) {
                this.quiz.elapsedSeconds++;
                const mins = Math.floor(this.quiz.elapsedSeconds / 60);
                const secs = this.quiz.elapsedSeconds % 60;
                quizTimerView.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                if (this.quiz.elapsedSeconds % 5 === 0) {
                    this.saveActiveQuizSession();
                }
            }
        }, 1000);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    window.app.init();
});

window.addEventListener("pagehide", () => {
    if (window.app && typeof window.app.saveActiveQuizSession === 'function') {
        window.app.saveActiveQuizSession();
    }
});
