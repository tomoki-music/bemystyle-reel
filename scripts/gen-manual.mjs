import { readFileSync, writeFileSync } from 'fs'

const SS = '/Users/tomokiimaizumi/bemystyle-reel/editor/docs/screenshots'
const OUT = '/Users/tomokiimaizumi/bemystyle-reel/editor/docs/user-manual.html'

const img = (file) => {
  try {
    const b64 = readFileSync(`${SS}/${file}`).toString('base64')
    return `data:image/png;base64,${b64}`
  } catch { return '' }
}

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BeMyStyle Reel — ユーザー操作マニュアル</title>
<style>
  :root {
    --purple: #9b6dff;
    --purple-light: #c4a7ff;
    --bg: #f8f7ff;
    --card: #ffffff;
    --border: #e5e0f5;
    --text: #1a1a2e;
    --muted: #6b6b8a;
    --orange: #ff6b35;
    --green: #22c55e;
    --red: #ef4444;
    --code-bg: #1e1e2e;
    --code-text: #cdd6f4;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic UI', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.7;
    font-size: 15px;
  }

  /* ── Cover ── */
  .cover {
    background: linear-gradient(135deg, #1a0a3e 0%, #2d1065 50%, #0f0f1a 100%);
    color: white;
    padding: 80px 60px 60px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .cover::before {
    content: '';
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at 30% 40%, rgba(155,109,255,0.3) 0%, transparent 60%),
                radial-gradient(ellipse at 70% 70%, rgba(99,44,255,0.2) 0%, transparent 50%);
  }
  .cover-inner { position: relative; z-index: 1; }
  .cover-logo { font-size: 48px; margin-bottom: 16px; }
  .cover h1 {
    font-size: 36px; font-weight: 800; letter-spacing: -0.5px;
    background: linear-gradient(90deg, #fff 0%, var(--purple-light) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    margin-bottom: 12px;
  }
  .cover-subtitle { font-size: 16px; color: rgba(255,255,255,0.65); margin-bottom: 40px; }
  .cover-meta {
    display: flex; gap: 24px; justify-content: center; flex-wrap: wrap;
    font-size: 13px; color: rgba(255,255,255,0.5);
  }
  .cover-meta span { display: flex; align-items: center; gap: 6px; }

  /* ── TOC ── */
  .toc {
    background: var(--card);
    border-bottom: 2px solid var(--border);
    padding: 40px 60px;
  }
  .toc h2 { font-size: 13px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; }
  .toc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .toc-item {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 14px 16px; border-radius: 10px;
    border: 1px solid var(--border);
    text-decoration: none; color: var(--text);
    transition: all 0.15s;
  }
  .toc-item:hover { border-color: var(--purple); background: #f5f0ff; }
  .toc-num { font-size: 20px; font-weight: 800; color: var(--purple); line-height: 1; min-width: 24px; }
  .toc-label { font-size: 14px; font-weight: 600; }
  .toc-desc { font-size: 12px; color: var(--muted); margin-top: 2px; }

  /* ── Content ── */
  .content { max-width: 960px; margin: 0 auto; padding: 60px 40px; }

  /* ── Section ── */
  .section { margin-bottom: 80px; }
  .section-header {
    display: flex; align-items: center; gap: 16px;
    margin-bottom: 32px; padding-bottom: 16px;
    border-bottom: 2px solid var(--border);
  }
  .section-num {
    width: 44px; height: 44px; border-radius: 12px;
    background: linear-gradient(135deg, var(--purple), #5b21b6);
    color: white; font-size: 20px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .section-title { font-size: 26px; font-weight: 800; }
  .section-subtitle { font-size: 14px; color: var(--muted); margin-top: 2px; }

  /* ── Step ── */
  .steps { display: flex; flex-direction: column; gap: 0; }
  .step {
    display: flex; gap: 0; position: relative;
  }
  .step:not(:last-child)::after {
    content: '';
    position: absolute; left: 20px; top: 44px; bottom: 0;
    width: 2px; background: var(--border);
    z-index: 0;
  }
  .step-num {
    width: 40px; height: 40px; border-radius: 50%;
    background: var(--purple); color: white;
    font-size: 16px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; position: relative; z-index: 1;
    margin-right: 20px; margin-top: 2px;
  }
  .step-body { flex: 1; padding-bottom: 36px; }
  .step-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  .step-desc { color: var(--muted); font-size: 14px; margin-bottom: 12px; }

  /* ── Screenshot ── */
  .screenshot-wrap {
    margin: 16px 0;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border);
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  }
  .screenshot-wrap.full-width img { width: 100%; display: block; }
  .screenshot-wrap.narrow { max-width: 380px; }
  .screenshot-wrap.narrow img { width: 100%; display: block; }
  .screenshot-caption {
    background: #f5f2ff;
    border-top: 1px solid var(--border);
    padding: 8px 14px;
    font-size: 12px; color: var(--muted);
    display: flex; align-items: center; gap: 6px;
  }
  .screenshot-caption::before { content: '📸'; }

  /* ── Two-column layout ── */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 16px 0; }

  /* ── Code ── */
  pre {
    background: var(--code-bg);
    color: var(--code-text);
    border-radius: 10px;
    padding: 20px 24px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px;
    line-height: 1.6;
    overflow-x: auto;
    margin: 12px 0;
  }
  code {
    background: #ede8ff;
    color: #5b21b6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px;
  }

  /* ── Callout ── */
  .callout {
    border-radius: 10px;
    padding: 16px 20px;
    margin: 16px 0;
    display: flex; gap: 12px; align-items: flex-start;
    font-size: 14px;
  }
  .callout-icon { font-size: 20px; flex-shrink: 0; }
  .callout.tip { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .callout.warn { background: #fff7ed; border: 1px solid #fed7aa; }
  .callout.danger { background: #fef2f2; border: 1px solid #fecaca; }
  .callout-title { font-weight: 700; margin-bottom: 4px; }

  /* ── Table ── */
  .table-wrap { overflow-x: auto; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th {
    background: linear-gradient(135deg, #2d1065, #1a0a3e);
    color: white; padding: 12px 16px; text-align: left;
    font-weight: 700; font-size: 13px;
  }
  th:first-child { border-radius: 8px 0 0 0; }
  th:last-child { border-radius: 0 8px 0 0; }
  td { padding: 11px 16px; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f9f7ff; }
  .btn-label {
    display: inline-flex; align-items: center; gap: 4px;
    background: #1a0a3e; color: #c4a7ff;
    padding: 3px 10px; border-radius: 6px;
    font-size: 12px; font-family: monospace; font-weight: 600;
    white-space: nowrap;
  }
  .badge-green { background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-orange { background: #ffedd5; color: #9a3412; padding: 2px 8px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-red { background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 20px; font-size: 12px; font-weight: 600; }

  /* ── Error section ── */
  .error-card {
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .error-header {
    background: #fef2f2;
    padding: 14px 20px;
    display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid #fecaca;
  }
  .error-title { font-size: 15px; font-weight: 700; color: #991b1b; }
  .error-body { padding: 16px 20px; font-size: 14px; }
  .error-body p { margin-bottom: 8px; color: var(--muted); }
  .error-body ol, .error-body ul { padding-left: 20px; }
  .error-body li { margin-bottom: 6px; }

  /* ── Print ── */
  @media print {
    .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section { page-break-inside: avoid; }
    .step { page-break-inside: avoid; }
    .error-card { page-break-inside: avoid; }
    body { font-size: 13px; }
  }
</style>
</head>
<body>

<!-- ══ Cover ══ -->
<div class="cover">
  <div class="cover-inner">
    <div class="cover-logo">🎬</div>
    <h1>BeMyStyle Reel<br>ユーザー操作マニュアル</h1>
    <p class="cover-subtitle">AI動画生成エディター — 完全操作ガイド</p>
    <div class="cover-meta">
      <span>📅 2026年6月</span>
      <span>🖥️ localhost:3001</span>
      <span>⚡ Vite + React + Remotion</span>
    </div>
  </div>
</div>

<!-- ══ TOC ══ -->
<div class="toc">
  <h2>目次</h2>
  <div class="toc-grid">
    <a class="toc-item" href="#sec1">
      <span class="toc-num">1</span>
      <div><div class="toc-label">起動手順</div><div class="toc-desc">npm run editor でサーバーを立ち上げる</div></div>
    </a>
    <a class="toc-item" href="#sec2">
      <span class="toc-num">2</span>
      <div><div class="toc-label">画面構成</div><div class="toc-desc">3パネルの役割と概要</div></div>
    </a>
    <a class="toc-item" href="#sec3">
      <span class="toc-num">3</span>
      <div><div class="toc-label">基本ワークフロー</div><div class="toc-desc">テーマ入力から動画保存まで</div></div>
    </a>
    <a class="toc-item" href="#sec4">
      <span class="toc-num">4</span>
      <div><div class="toc-label">ファクトリー実行</div><div class="toc-desc">1ボタンで全工程を自動化</div></div>
    </a>
    <a class="toc-item" href="#sec5">
      <span class="toc-num">5</span>
      <div><div class="toc-label">各ボタン役割一覧</div><div class="toc-desc">全ボタンの早見表</div></div>
    </a>
    <a class="toc-item" href="#sec6">
      <span class="toc-num">6</span>
      <div><div class="toc-label">エラーと対処法</div><div class="toc-desc">よくある問題の解決策</div></div>
    </a>
  </div>
</div>

<!-- ══ Content ══ -->
<div class="content">

<!-- ── Section 1: 起動 ── -->
<div class="section" id="sec1">
  <div class="section-header">
    <div class="section-num">1</div>
    <div>
      <div class="section-title">起動手順</div>
      <div class="section-subtitle">2つのサーバーが同時に立ち上がります</div>
    </div>
  </div>

  <div class="callout warn">
    <span class="callout-icon">⚠️</span>
    <div>
      <div class="callout-title">事前確認：APIキー設定</div>
      <code>editor/.env</code> ファイルに OpenAI API キーが設定されていることを確認してください。
      <pre>OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx</pre>
    </div>
  </div>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <div class="step-title">ターミナルでプロジェクトルートへ移動</div>
        <pre>cd bemystyle-reel</pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <div class="step-title">起動コマンドを実行</div>
        <pre>npm run editor</pre>
        <div class="step-desc">Vite（フロント）と Express（API）が concurrently で同時起動します</div>
        <div class="table-wrap">
          <table>
            <tr><th>サービス</th><th>URL</th><th>役割</th></tr>
            <tr><td>編集UI（Vite）</td><td><strong>http://localhost:3001</strong></td><td>React フロントエンド</td></tr>
            <tr><td>APIサーバー（Express）</td><td>http://localhost:3002</td><td>OpenAI呼び出し・レンダリング制御</td></tr>
          </table>
        </div>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <div class="step-title">ブラウザで <code>http://localhost:3001</code> を開く</div>
        <div class="screenshot-wrap full-width">
          <img src="${img('01_overview.png')}" alt="アプリ起動画面">
          <div class="screenshot-caption">起動直後の画面 — 3パネル構成で表示されます</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ── Section 2: 画面構成 ── -->
<div class="section" id="sec2">
  <div class="section-header">
    <div class="section-num">2</div>
    <div>
      <div class="section-title">画面構成</div>
      <div class="section-subtitle">左・中央・右の3パネルで構成されています</div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <div class="screenshot-wrap narrow">
        <img src="${img('02_slide_list.png')}" alt="左パネル">
        <div class="screenshot-caption">左パネル — スライド一覧・テンプレート・AI生成</div>
      </div>
    </div>
    <div>
      <div class="screenshot-wrap narrow">
        <img src="${img('07_edit_form.png')}" alt="右パネル">
        <div class="screenshot-caption">右パネル — 選択スライドの編集フォーム</div>
      </div>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <tr><th>パネル</th><th>場所</th><th>主な機能</th></tr>
      <tr>
        <td><strong>左パネル</strong></td>
        <td>画面左端</td>
        <td>スライド一覧・テンプレート管理・テーマ入力・ストーリー生成・ファクトリー実行・レンダーキュー</td>
      </tr>
      <tr>
        <td><strong>中央パネル</strong></td>
        <td>画面中央</td>
        <td>スライドのリアルタイムプレビュー（スマホフレームで確認）</td>
      </tr>
      <tr>
        <td><strong>右パネル</strong></td>
        <td>画面右端</td>
        <td>選択中スライドの見出し・サブテキスト・背景画像・演出などの編集フォーム</td>
      </tr>
    </table>
  </div>
</div>

<!-- ── Section 3: 基本ワークフロー ── -->
<div class="section" id="sec3">
  <div class="section-header">
    <div class="section-num">3</div>
    <div>
      <div class="section-title">基本ワークフロー</div>
      <div class="section-subtitle">テーマ入力 → ストーリー生成 → AI画像生成 → 保存 → 動画レンダリング</div>
    </div>
  </div>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <div class="step-title">テーマを入力する</div>
        <div class="step-desc">左パネルの「テーマ入力」欄にリールのテーマを入力します</div>
        <div class="screenshot-wrap narrow">
          <img src="${img('03_theme_input.png')}" alt="テーマ入力">
          <div class="screenshot-caption">テーマ入力欄 — Enter キーでも生成できます</div>
        </div>
        <div class="callout tip">
          <span class="callout-icon">💡</span>
          <div><strong>入力例：</strong>「猫カフェで働くOLの1日」「登山で学んだ3つの教訓」「ミニマリストの朝のルーティン」</div>
        </div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <div class="step-title">「ストーリー生成」ボタンをクリック</div>
        <div class="step-desc">GPT-4o により14枚分のスライドテキストが自動生成されます（約10〜20秒）</div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <div class="step-title">各スライドを確認・編集（任意）</div>
        <div class="step-desc">左パネルのスライドリストをクリックすると右パネルに編集フォームが表示されます</div>
        <div class="screenshot-wrap narrow">
          <img src="${img('07_edit_form.png')}" alt="スライド編集フォーム">
          <div class="screenshot-caption">右パネル — 見出し・サブテキスト・強調ワードを個別編集</div>
        </div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <div class="step-title">「動画生成」ボタンで動画をレンダリング</div>
        <div class="step-desc">ストーリーと画像が揃ったらオレンジの「動画生成」ボタンをクリック</div>
        <div class="screenshot-wrap">
          <img src="${img('05_render_area.png')}" alt="レンダーエリア">
          <div class="screenshot-caption">レンダーエリア — 事前チェック（✅/⚠️）を確認してから生成ボタンを押す</div>
        </div>
        <div class="callout warn">
          <span class="callout-icon">⚠️</span>
          <div>
            <div class="callout-title">生成前に事前チェックを確認</div>
            ✅ ストーリー 14枚、✅ 生成済み画像 14/14枚、✅ 保存済み — 3つが揃っていることを確認してください
          </div>
        </div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">5</div>
      <div class="step-body">
        <div class="step-title">完了後「ダウンロード」で保存</div>
        <div class="step-desc">レンダリングが完了するとレンダーキューに「ダウンロード」リンクが現れます</div>
      </div>
    </div>
  </div>
</div>

<!-- ── Section 4: ファクトリー実行 ── -->
<div class="section" id="sec4">
  <div class="section-header">
    <div class="section-num">4</div>
    <div>
      <div class="section-title">ファクトリー実行</div>
      <div class="section-subtitle">ストーリー生成〜レンダーキュー追加を1ボタンで全自動化</div>
    </div>
  </div>

  <div class="callout tip">
    <span class="callout-icon">🏭</span>
    <div>
      <div class="callout-title">ファクトリー実行とは？</div>
      テーマを入力するだけで「ストーリー生成 → バリアント生成 → スコアリング → リライト → レンダーキュー追加」を6ステップ自動実行する機能です。
    </div>
  </div>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <div class="step-title">テーマ入力欄にテーマを入力</div>
        <div class="step-desc">「テーマ入力」欄に動画のテーマを書いてください（ファクトリーボタンの直上にあります）</div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <div class="step-title">「🏭 ファクトリー実行」ボタンをクリック</div>
        <div class="screenshot-wrap narrow">
          <img src="${img('04_factory_panel.png')}" alt="ファクトリーパネル">
          <div class="screenshot-caption">AI Reel Factory パネル — 実行ボタンをクリックで開始</div>
        </div>
        <div class="callout tip">
          <span class="callout-icon">⏱️</span>
          <div>実行中は <strong>「🏭 実行中...」</strong> と表示され、6ステップの進行状況がリアルタイムで表示されます。完了まで2〜5分ほどかかります。</div>
        </div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <div class="step-title">完了後：レンダーキューを確認する</div>
        <div class="step-desc">ファクトリー実行が完了するとレンダーキューにバリアントが追加されます</div>
        <div class="table-wrap">
          <table>
            <tr><th>操作</th><th>ボタン</th><th>内容</th></tr>
            <tr>
              <td>内容を確認する</td>
              <td><span class="btn-label">📸 スナップショットを見る</span></td>
              <td>生成されたスライドの見出し・画像をプレビュー表示</td>
            </tr>
            <tr>
              <td>変更差分を確認する</td>
              <td><span class="btn-label">Diff</span></td>
              <td>リライト前後の変更点を色付きで表示</td>
            </tr>
            <tr>
              <td>動画を生成する</td>
              <td><span class="btn-label">▶ キューレンダー</span></td>
              <td>キュー内の全バリアントを順次レンダリング</td>
            </tr>
            <tr>
              <td>動画を保存する</td>
              <td><span class="btn-label">ダウンロード</span></td>
              <td>レンダリング完了後に .mp4 をダウンロード</td>
            </tr>
          </table>
        </div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <div class="step-title">履歴を確認する（任意）</div>
        <div class="step-desc">過去のファクトリー実行結果は「Factory History」パネルで確認・絞り込みできます</div>
        <div class="screenshot-wrap narrow">
          <img src="${img('08_factory_history.png')}" alt="ファクトリー履歴">
          <div class="screenshot-caption">Factory History — 実行済み結果の一覧（Import で復元も可能）</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- ── Section 5: ボタン一覧 ── -->
<div class="section" id="sec5">
  <div class="section-header">
    <div class="section-num">5</div>
    <div>
      <div class="section-title">各ボタン役割一覧</div>
      <div class="section-subtitle">全ボタンの早見表</div>
    </div>
  </div>

  <h3 style="font-size:16px;font-weight:700;margin:24px 0 12px;color:var(--purple)">▍ メインエリア（左パネル上部）</h3>
  <div class="table-wrap">
    <table>
      <tr><th>ボタン</th><th>役割</th><th>条件</th></tr>
      <tr>
        <td><span class="btn-label">ストーリー生成</span></td>
        <td>GPT-4o でテーマから14枚分のスライドテキストを生成</td>
        <td>テーマ入力必須</td>
      </tr>
      <tr>
        <td><span class="btn-label">14枚AI画像生成</span></td>
        <td>DALL-E 3 で各スライドの背景画像を生成</td>
        <td>ストーリー生成後</td>
      </tr>
      <tr>
        <td><span class="btn-label">保存</span></td>
        <td>スライドデータをサーバーに書き込む（レンダリング前に必須）</td>
        <td>いつでも可</td>
      </tr>
    </table>
  </div>

  <h3 style="font-size:16px;font-weight:700;margin:24px 0 12px;color:var(--purple)">▍ レンダーエリア（左パネル中部）</h3>
  <div class="table-wrap">
    <table>
      <tr><th>ボタン</th><th>役割</th><th>条件</th></tr>
      <tr>
        <td><span class="btn-label">🎬 動画生成</span></td>
        <td>現在のスライドで動画をレンダリング開始（オレンジの大きなボタン）</td>
        <td>保存済み必須</td>
      </tr>
      <tr>
        <td><span class="btn-label">✨ 自動生成</span></td>
        <td>複数バリアントを自動生成してキューに追加</td>
        <td>—</td>
      </tr>
      <tr>
        <td><span class="btn-label">＋ 追加</span></td>
        <td>現在のスライドをレンダーキューに手動追加</td>
        <td>—</td>
      </tr>
      <tr>
        <td><span class="btn-label">▶ キューレンダー</span></td>
        <td>キュー内の全バリアントを順次レンダリング</td>
        <td>キューにアイテムあり</td>
      </tr>
    </table>
  </div>

  <h3 style="font-size:16px;font-weight:700;margin:24px 0 12px;color:var(--purple)">▍ レンダーキュー（各アイテム）</h3>
  <div class="table-wrap">
    <table>
      <tr><th>ボタン</th><th>役割</th></tr>
      <tr>
        <td><span class="btn-label">📸 スナップショットを見る</span></td>
        <td>バリアントのスライド内容（見出し・画像）をプレビュー表示</td>
      </tr>
      <tr>
        <td><span class="btn-label">スナップショットを隠す</span></td>
        <td>プレビューを折りたたむ</td>
      </tr>
      <tr>
        <td><span class="btn-label">AIリライト分析</span></td>
        <td>スライド内容のAI改善提案（サマリー・理由・改善点・リスク）を表示</td>
      </tr>
      <tr>
        <td><span class="btn-label">ダウンロード</span></td>
        <td>レンダリング済み .mp4 をダウンロード（完了後のみ表示）</td>
      </tr>
    </table>
  </div>

  <h3 style="font-size:16px;font-weight:700;margin:24px 0 12px;color:var(--purple)">▍ ファクトリーパネル</h3>
  <div class="table-wrap">
    <table>
      <tr><th>ボタン</th><th>役割</th></tr>
      <tr>
        <td><span class="btn-label">🏭 ファクトリー実行</span></td>
        <td>ストーリー生成〜レンダーキュー追加まで6ステップを全自動実行</td>
      </tr>
      <tr>
        <td><span class="btn-label">Import</span></td>
        <td>Factory History の JSON をインポートして履歴を復元</td>
      </tr>
    </table>
  </div>

  <h3 style="font-size:16px;font-weight:700;margin:24px 0 12px;color:var(--purple)">▍ パイプライン系ボタン</h3>
  <div class="table-wrap">
    <table>
      <tr><th>ボタン</th><th>役割</th></tr>
      <tr>
        <td><span class="btn-label">🚀 自動レンダーパイプライン</span></td>
        <td>生成〜レンダリング〜Compare までを自動化するパイプライン実行</td>
      </tr>
      <tr>
        <td><span class="btn-label">🧠⚡ スマートパイプライン</span></td>
        <td>AIがスコアを評価しながらリライトを繰り返す高品質パイプライン</td>
      </tr>
      <tr>
        <td><span class="btn-label">🪄⚡ スマートリライト</span></td>
        <td>現在のスライドをAIが自動リライトして品質向上</td>
      </tr>
      <tr>
        <td><span class="btn-label">🪄🔧 マルチリライトキュー</span></td>
        <td>複数バリアントを並列でリライト・比較するキュー</td>
      </tr>
    </table>
  </div>
</div>

<!-- ── Section 6: エラー対処 ── -->
<div class="section" id="sec6">
  <div class="section-header">
    <div class="section-num">6</div>
    <div>
      <div class="section-title">よくあるエラーと対処法</div>
      <div class="section-subtitle">問題が発生したときの確認手順</div>
    </div>
  </div>

  <div class="error-card">
    <div class="error-header">
      <span>🔑</span>
      <div class="error-title">「OPENAI_API_KEY が設定されていません」</div>
    </div>
    <div class="error-body">
      <p><strong>原因：</strong> <code>editor/.env</code> にAPIキーが書かれていないか、サーバー起動前に読み込まれていない</p>
      <ol>
        <li><code>editor/.env</code> ファイルを確認する
          <pre>OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx</pre>
        </li>
        <li>ファイルが存在しない場合は新規作成する</li>
        <li><code>npm run editor</code> でサーバーを再起動する</li>
      </ol>
    </div>
  </div>

  <div class="error-card">
    <div class="error-header">
      <span>🔗</span>
      <div class="error-title">404 Not Found（API呼び出し時）</div>
    </div>
    <div class="error-body">
      <p><strong>原因：</strong> APIサーバー（port 3002）が起動していない</p>
      <ol>
        <li>ターミナルで <code>npm run editor</code> を再実行し、<code>[api]</code> のログが出ているか確認</li>
        <li>ポート 3002 が別プロセスに使用されていないか確認：
          <pre>lsof -i :3002</pre>
        </li>
        <li>競合プロセスがある場合は <code>kill &lt;PID&gt;</code> してから再起動</li>
      </ol>
    </div>
  </div>

  <div class="error-card">
    <div class="error-header">
      <span>🖼️</span>
      <div class="error-title">画像生成がタイムアウト・失敗する</div>
    </div>
    <div class="error-body">
      <p><strong>原因：</strong> DALL-E 3 のAPIレスポンスが遅い、またはネットワーク問題</p>
      <ol>
        <li>ブラウザの開発者ツール（F12 → Network）でエラー内容を確認</li>
        <li>OpenAI のステータスページで障害がないか確認</li>
        <li>時間をおいて再試行する（DALL-E 3 は1分1枚の速度制限がある場合あり）</li>
      </ol>
    </div>
  </div>

  <div class="error-card">
    <div class="error-header">
      <span>🎬</span>
      <div class="error-title">レンダリングが完了しない（進行が止まる）</div>
    </div>
    <div class="error-body">
      <p><strong>原因：</strong> Remotion のレンダリングプロセスがクラッシュしている</p>
      <ol>
        <li>ターミナルの <code>[api]</code> ログにエラーメッセージが出ていないか確認</li>
        <li><code>npm run editor</code> を再起動する</li>
        <li>スライドデータを再保存してから「▶ キューレンダー」を再実行する</li>
      </ol>
    </div>
  </div>

  <div class="callout danger">
    <span class="callout-icon">🚨</span>
    <div>
      <div class="callout-title">注意：保存前にレンダリングすると古い内容で動画が生成される</div>
      ストーリー生成・画像生成後は必ず「保存」ボタンを押してから「▶ キューレンダー」を実行してください。
      保存をスキップすると<strong>直前に保存されたスライド内容</strong>で動画が生成されます。
    </div>
  </div>
</div>

</div><!-- /content -->

<footer style="background:#1a0a3e;color:rgba(255,255,255,0.4);text-align:center;padding:32px;font-size:13px;">
  BeMyStyle Reel — ユーザー操作マニュアル &nbsp;|&nbsp; 2026年6月
</footer>

</body>
</html>`

writeFileSync(OUT, html, 'utf8')
console.log('✅ Generated:', OUT)
console.log('Size:', (html.length / 1024).toFixed(1), 'KB')
