// dsh-share-room guest page. Plain DOM, textContent only (no HTML string sinks),
// served under CSP script-src 'self'. Talks only to /share/<id>/*.
(() => {
  'use strict'
  /* SHARE_ROOM_I18N */
  const locale = normalizeLocale(new URL(location.href).searchParams.get('lang') || navigator.language)
  const t = (key, values) => translate(locale, key, values)
  document.documentElement.lang = locale
  document.title = t('分享的對話')
  const shareId = document.body.dataset.share
  const base = `/share/${shareId}/`
  const localized = path => path + (path.includes('?') ? '&' : '?') + 'lang=' + encodeURIComponent(locale)
  const app = document.getElementById('app')

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') node.className = v
      else if (k === 'text') node.textContent = v
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
      else node.setAttribute(k, v === true ? '' : String(v))
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)))
    return node
  }
  const clear = (node) => { while (node.firstChild) node.firstChild.remove() }
  const time = (at) => { try { return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
  const date = (at) => { try { return new Date(at).toLocaleString(locale) } catch { return '' } }

  async function post(path, body) {
    const res = await fetch(localized(base + path), { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    let data = null
    try { data = await res.json(); if (data?.message) data.message = translateError(locale, data.message) } catch {}
    return { ok: res.ok, status: res.status, data }
  }

  function notice(title, text) {
    clear(app)
    app.append(el('section', { class: 'card center', 'data-view': 'notice' }, el('h1', { text: title }), text && el('p', { class: 'muted', text })))
  }

  // The site switched sharing off: nothing is lost, it may come back.
  function paused(message, retry = () => location.reload()) {
    clear(app)
    const again = el('button', { class: 'primary', 'data-testid': 'retry', text: t("重新整理") })
    again.addEventListener('click', () => retry())
    app.append(el('section', { class: 'card center', 'data-view': 'paused' },
      el('h1', { text: t("分享暫停中") }),
      el('p', { class: 'muted', text: translateError(locale, message) || t("分享者的網站目前關閉了分享功能。") }),
      el('p', { class: 'muted', text: t("分享者重新開啟後，重新整理這一頁就能繼續。") }),
      again))
  }

  // ---------------------------------------------------------------------------
  // 1. Invite in the URL fragment → confirm → join (consumes it)

  async function confirmInvite(invite) {
    // Drop the secret from the address bar and history right away.
    history.replaceState(null, '', localized(base))
    const info = await post('invite-info', { invite })
    if (info.status === 403 && info.data?.error === 'disabled') {
      // Not consumed: keep it in the address so a later reload can still use it.
      history.replaceState(null, '', localized(base) + '#' + invite)
      return paused(info.data.message)
    }
    if (!info.ok) {
      // Maybe this browser already joined; fall through to the room.
      const state = await fetch(localized(base + 'state'), { credentials: 'same-origin', cache: 'no-store' })
      if (state.ok) return room()
      return notice(t("連結無法使用"), info.data?.message ?? t("這個邀請連結無效、已用過或已過期。請向分享者索取新的連結。"))
    }
    const { title, ownerName, guestName } = info.data
    clear(app)
    const button = el('button', { class: 'primary', 'data-testid': 'join', text: t("以「{0}」加入", [guestName]) })
    const error = el('p', { class: 'error', role: 'alert' })
    button.addEventListener('click', async () => {
      button.disabled = true
      const res = await post('join', { invite })
      if (!res.ok) { button.disabled = false; error.textContent = res.data?.message ?? t("無法加入。"); return }
      room()
    })
    app.append(el('section', { class: 'card center', 'data-view': 'confirm' },
      el('p', { class: 'muted', text: t("{0} 邀請你加入對話", [ownerName]) }),
      el('h1', { text: title }),
      el('p', { text: t("加入後可以一起討論，也可以請 AI 回答。這個連結只能用一次，請在你要使用的瀏覽器打開。") }),
      button, error))
  }

  // ---------------------------------------------------------------------------
  // 2. The room

  const state = { info: null, items: [], discussion: [], upTo: 0, mode: 'discuss', connected: false, busy: false, approval: new Set(), ended: false, questions: { canAnswer: false, pending: [] } }
  let views = null
  let source = null

  function buildRoom() {
    clear(app)
    const header = el('header', { class: 'bar' })
    const log = el('div', { class: 'log', 'data-testid': 'log', 'aria-live': 'polite' })
    const status = el('div', { class: 'status' })
    const textarea = el('textarea', { rows: 2, maxlength: 4000, placeholder: t("輸入訊息…"), 'data-testid': 'input' })
    const modeButton = el('button', { type: 'button', class: 'mode', 'data-testid': 'mode' })
    const send = el('button', { type: 'submit', class: 'primary', text: t("送出"), 'data-testid': 'send' })
    const error = el('p', { class: 'error', role: 'alert' })
    const form = el('form', { class: 'composer' }, el('div', { class: 'row' }, modeButton, el('span', { class: 'hint' })), textarea, el('div', { class: 'row end' }, error, send))
    const asks = el('div', { class: 'asks', 'data-testid': 'asks' })
    const footer = el('footer', {}, asks, status, form)
    modeButton.addEventListener('click', () => { state.mode = state.mode === 'discuss' ? 'ai' : 'discuss'; render() })
    textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit() } })
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const text = textarea.value.trim()
      if (!text) return
      send.disabled = true
      error.textContent = ''
      const res = await post('say', { text, mode: state.mode })
      send.disabled = false
      if (!res.ok) { error.textContent = res.data?.message ?? t("送出失敗（{0}）", [res.status]); return }
      textarea.value = ''
      if (state.mode === 'ai') { state.busy = true; render() }
    })
    app.append(el('div', { class: 'room' }, header, log, footer))
    views = { header, log, status, asks, textarea, modeButton, send, form, hint: form.querySelector('.hint') }
  }

  // Questions the AI is waiting on (a choice, or a plan to approve). Guests can
  // answer only when the share runs with full access; otherwise they just see it.
  // Text only, like everything else here.
  function renderAsks() {
    const { asks } = views
    clear(asks)
    const { canAnswer, pending } = state.questions
    if (!pending.length || state.info?.access !== 'active') return
    for (const p of pending) {
      const box = el('div', { class: 'ask', 'data-testid': 'ask' })
      const picks = new Map() // question id -> Set(label)
      const customs = new Map()
      for (const q of p.questions) {
        picks.set(q.id, new Set())
        box.append(el('div', { class: 'ask-title', text: q.plan ? t("📋 AI 提出計畫，等待核准") : `❓ ${q.header || t("AI 的問題")}` }))
        if (q.question) box.append(el('div', { class: 'ask-q', text: q.question }))
        if (q.detail) box.append(el('pre', { class: 'ask-detail', text: q.detail }))
        if (!canAnswer) continue
        const opts = el('div', { class: 'ask-opts' })
        for (const o of q.options) {
          const b = el('button', { type: 'button', class: 'opt', 'data-testid': 'opt', text: o.label, title: o.description || undefined })
          b.addEventListener('click', () => {
            const set = picks.get(q.id)
            if (q.multiSelect) { set.has(o.label) ? set.delete(o.label) : set.add(o.label) } else { set.clear(); set.add(o.label) }
            for (const x of opts.children) x.classList.toggle('on', set.has(x.textContent))
          })
          opts.append(b)
        }
        box.append(opts)
        if (!q.plan) {
          const other = el('input', { type: 'text', class: 'ask-other', placeholder: t("或自己輸入…"), maxlength: 4000 })
          other.addEventListener('input', () => customs.set(q.id, other.value))
          box.append(other)
        }
      }
      if (canAnswer) {
        const err = el('p', { class: 'error', role: 'alert' })
        const go = el('button', { type: 'button', class: 'primary', 'data-testid': 'answer', text: t("送出回答") })
        go.addEventListener('click', async () => {
          go.disabled = true
          const answers = p.questions.map((q) => ({ id: q.id, selected: [...picks.get(q.id)], ...(customs.get(q.id)?.trim() ? { custom: customs.get(q.id).trim() } : {}) }))
          const res = await post('answer', { questionId: p.id, answers })
          if (!res.ok) { go.disabled = false; err.textContent = res.data?.message ?? t("送出失敗（{0}）", [res.status]) }
        })
        box.append(el('div', { class: 'row end' }, err, go))
      } else {
        box.append(el('p', { class: 'muted small', text: t("⏳ 等分享者回答") }))
      }
      asks.append(box)
    }
  }

  function bubble(kind, who, at, body, extra = {}) {
    return el('div', { class: `msg ${kind}`, ...extra },
      el('div', { class: 'meta' }, el('b', { text: who }), el('span', { class: 'muted', text: time(at) })),
      body instanceof Node ? body : el('div', { class: 'body', text: body }))
  }

  // AI answers: Markdown → a fixed set of elements, text only (markdown.js
  // returns a tree, never HTML). Links and images stay plain text.
  const md = globalThis.shareRoomMarkdown
  function mdInline(runs) {
    return runs.map((r) => typeof r === 'string' ? document.createTextNode(r)
      : r.t === 'code' ? el('code', { text: r.text })
        : el({ b: 'strong', i: 'em', s: 'del' }[r.t] ?? 'span', {}, mdInline(r.c)))
  }
  function mdBlock(b) {
    switch (b.t) {
      case 'h': return el(`h${Math.min(6, Math.max(3, b.level + 2))}`, {}, mdInline(b.c))
      case 'p': return el('p', {}, mdInline(b.c))
      case 'ul': return el('ul', {}, b.items.map((c) => el('li', {}, mdInline(c))))
      case 'ol': return el('ol', { start: b.start !== 1 ? b.start : undefined }, b.items.map((c) => el('li', {}, mdInline(c))))
      case 'code': return el('pre', {}, el('code', { text: b.text }))
      case 'quote': return el('blockquote', {}, b.c.map(mdBlock))
      case 'hr': return el('hr')
      case 'table': {
        const cell = (tag, c, k) => el(tag, { class: b.align[k] ? `align-${b.align[k]}` : undefined }, mdInline(c))
        return el('div', { class: 'table' }, el('table', {},
          el('thead', {}, el('tr', {}, b.head.map((c, k) => cell('th', c, k)))),
          el('tbody', {}, b.rows.map((row) => el('tr', {}, row.map((c, k) => cell('td', c, k)))))))
      }
      default: return document.createTextNode('')
    }
  }
  function answerBody(text) {
    if (!md) return el('div', { class: 'body', text })
    try { return el('div', { class: 'body md' }, md.parse(text).map(mdBlock)) } catch { return el('div', { class: 'body', text }) }
  }

  function render() {
    if (!views) buildRoom()
    const { header, log, status, textarea, modeButton, send, form, hint } = views
    const info = state.info
    clear(header)
    header.append(
      el('div', {}, el('div', { class: 'title', text: info?.title ?? t("分享的對話") }), el('div', { class: 'muted small', text: info ? t("{0} 分享 · 你是「{1}」", [info.ownerName, info.me.name]) : '' })),
      el('a', { class: 'button', href: localized(base + 'transcript.md'), download: '', 'data-testid': 'download', text: t("下載副本") }),
    )
    // Timeline: AI asks/answers/tools and 💬 discussion, merged by time.
    const rows = []
    const tools = new Map()
    for (const item of state.items) {
      if (item.kind === 'tool') tools.set(item.callId, { ...item, done: false, ok: true })
      if (item.kind === 'tool-done' && tools.has(item.callId)) Object.assign(tools.get(item.callId), { done: true, ok: item.ok })
    }
    let lastAt = 0
    for (const item of state.items) {
      if (item.at) lastAt = item.at
      if (item.kind === 'ask' || item.kind === 'answer') rows.push({ at: item.at ?? lastAt, order: 1, item })
      else if (item.kind === 'tool') rows.push({ at: item.at ?? lastAt, order: 1, item: tools.get(item.callId) })
    }
    for (const m of state.discussion) rows.push({ at: Date.parse(m.at) || 0, order: 0, discussion: m })
    rows.sort((a, b) => a.at - b.at || a.order - b.order)
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80
    clear(log)
    if (rows.length === 0) log.append(el('p', { class: 'muted center', text: t("還沒有任何訊息。") }))
    for (const row of rows) {
      if (row.discussion) {
        const m = row.discussion
        log.append(bubble(`discuss${m.seq <= state.upTo ? ' bundled' : ''}`, `💬 ${m.name}`, m.at, m.text, { 'data-discussion': m.seq }))
      } else if (row.item.kind === 'ask') {
        const i = row.item
        const node = bubble(`ask ${i.speaker.role}`, t("🤖 {0} 問 AI", [i.speaker.name]), i.at, i.text, { 'data-seq': i.seq })
        if (i.discussion.length > 0) node.append(el('div', { class: 'muted small', text: t("（附帶 {0} 則討論）", [i.discussion.length]) }))
        log.append(node)
      } else if (row.item.kind === 'answer') {
        log.append(bubble('answer', 'AI', row.item.at, answerBody(row.item.text), { 'data-seq': row.item.seq }))
      } else if (row.item.kind === 'tool') {
        const t = row.item
        log.append(el('div', { class: 'tool muted small', 'data-seq': t.seq, text: `⚙ ${t.label} ${t.done ? (t.ok ? '✓' : '✗') : '…'}` }))
      }
    }
    if (nearBottom) log.scrollTop = log.scrollHeight

    const active = info?.access === 'active'
    const statusText = []
    if (!active) statusText.push(info?.access === 'readonly' ? t("分享已結束（{0}）。你仍可閱讀和下載副本。", [date(info.endedAt)]) : t("分享已結束。"))
    else if (info?.archived) statusText.push(t("⏸ 分享者已封存這個對話，暫時不能發言或問 AI。分享者取消封存後就會恢復。"))
    else if (info?.permissionPaused) statusText.push(t("⏸ 分享者暫時調高了這個對話的權限，現在不能問 AI（仍可討論）。"))
    else {
      if (state.questions.pending.length > 0) statusText.push(state.questions.canAnswer ? t("❓ AI 在等回答（下方可以作答）") : t("⏳ AI 在等分享者回答問題"))
      else if (state.approval.size > 0) statusText.push(t("⏳ 等待分享者核准 AI 的操作"))
      else if (state.busy) statusText.push(t("🤖 AI 處理中…"))
      if (!state.connected) statusText.push(t("連線中斷，重新連線中…"))
    }
    status.textContent = statusText.join('　')
    renderAsks()
    status.dataset.testid = 'status'
    form.hidden = !active || info?.archived === true
    if (active) {
      if (!info.aiAllowed && state.mode === 'ai') state.mode = 'discuss'
      modeButton.disabled = !info.aiAllowed
      modeButton.textContent = state.mode === 'discuss' ? t("💬 討論") : t("🤖 問 AI")
      modeButton.dataset.mode = state.mode
      hint.textContent = state.mode === 'discuss'
        ? (info.aiAllowed ? t("大家即時看到，AI 不會回覆。點左邊切換成問 AI。") : t("分享者沒有開放問 AI。"))
        : t("AI 會回覆，並讀到上次問 AI 之後的討論。剩 {0} 次。", [info.aiLeft])
      textarea.placeholder = state.mode === 'discuss' ? t("和大家討論…") : t("問 AI…")
    }
    send.disabled = false
  }

  function applyItems(items, reset) {
    if (reset) state.items = items
    else state.items.push(...items)
    // Busy = the last turn marker says a turn is running.
    for (const i of items) {
      if (i.kind === 'busy') state.busy = i.busy
      if (i.kind === 'approval') { if (i.pending) state.approval.add(i.id); else state.approval.delete(i.id) }
    }
    if (reset) {
      state.approval = new Set()
      let busy = false
      for (const i of items) {
        if (i.kind === 'busy') busy = i.busy
        if (i.kind === 'approval') { if (i.pending) state.approval.add(i.id); else state.approval.delete(i.id) }
      }
      state.busy = busy
    }
  }

  function connect() {
    source?.close()
    source = new EventSource(localized(base + 'events'))
    source.onopen = () => { state.connected = true; render() }
    source.onerror = async () => {
      state.connected = false
      source.close()
      // Why did it drop? Removed or ended shares answer without a stream.
      const res = await fetch(localized(base + 'state'), { credentials: 'same-origin', cache: 'no-store' }).catch(() => null)
      if (res && res.status === 403) { const d = await res.json().catch(() => ({})); if (d.error === 'disabled') return paused(d.message) }
      if (res && res.status === 401) { const d = await res.json().catch(() => ({})); return notice(d.ended ? t("分享已結束") : t("你已不在這個分享中"), d.ended ? t("分享者已經結束這個分享。") : t("分享者已將你移出這個分享。")) }
      if (res && res.status === 410) {
        const d = await res.json().catch(() => ({}))
        return notice(t("分享已結束"), d.state?.endedAt ? t("結束於 {0}。", [date(d.state.endedAt)]) : '')
      }
      render()
      setTimeout(connect, 2000)
    }
    source.onmessage = (event) => {
      let data
      try { data = JSON.parse(event.data) } catch { return }
      if (data.type === 'state') state.info = data.state
      else if (data.type === 'reset') applyItems(data.items, true)
      else if (data.type === 'items') applyItems(data.items, false)
      else if (data.type === 'discussion-reset') { state.discussion = data.messages; state.upTo = data.upTo }
      else if (data.type === 'discussion') { if (!state.discussion.some((m) => m.seq === data.message.seq)) state.discussion.push(data.message) }
      else if (data.type === 'bundled') state.upTo = Math.max(state.upTo, data.upTo)
      else if (data.type === 'questions') state.questions = { canAnswer: data.canAnswer === true, pending: Array.isArray(data.pending) ? data.pending : [] }
      else if (data.type === 'removed') { source.close(); return notice(t("你已不在這個分享中"), t("分享者已將你移出這個分享。")) }
      else if (data.type === 'disabled') { source.close(); return paused(data.message) }
      render()
    }
  }

  async function room() {
    const res = await fetch(localized(base + 'state'), { credentials: 'same-origin', cache: 'no-store' })
    if (res.status === 401) {
      const d = await res.json().catch(() => ({}))
      return notice(d.ended ? t("分享已結束") : t("需要邀請連結"), d.ended ? t("這個分享已經結束。") : t("請使用分享者給你的邀請連結打開這個頁面。"))
    }
    if (res.status === 410) return notice(t("分享已結束"), '')
    if (res.status === 403) { const d = await res.json().catch(() => ({})); if (d.error === 'disabled') return paused(d.message) }
    if (!res.ok) return notice(t("暫時無法載入"), t("（{0}）請稍後重新整理。", [res.status]))
    state.info = await res.json()
    render()
    connect()
  }

  const fragment = location.hash.slice(1)
  if (/^[A-Za-z0-9_-]{43}$/.test(fragment)) confirmInvite(fragment)
  else room()
})()
