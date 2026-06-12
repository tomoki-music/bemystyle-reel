import React from 'react'
import type {
  SimpleTemplateType,
  FreeDiagnosisForm,
  NoteArticleForm,
  YoutubeVideoForm,
  MusicCommunityForm,
} from '../../types'

interface Props {
  templateType: SimpleTemplateType
  freeDiagnosisForm: FreeDiagnosisForm
  setFreeDiagnosisForm: React.Dispatch<React.SetStateAction<FreeDiagnosisForm>>
  noteArticleForm: NoteArticleForm
  setNoteArticleForm: React.Dispatch<React.SetStateAction<NoteArticleForm>>
  youtubeVideoForm: YoutubeVideoForm
  setYoutubeVideoForm: React.Dispatch<React.SetStateAction<YoutubeVideoForm>>
  musicCommunityForm: MusicCommunityForm
  setMusicCommunityForm: React.Dispatch<React.SetStateAction<MusicCommunityForm>>
}

export const SimpleTemplateForms: React.FC<Props> = ({
  templateType,
  freeDiagnosisForm,
  setFreeDiagnosisForm,
  noteArticleForm,
  setNoteArticleForm,
  youtubeVideoForm,
  setYoutubeVideoForm,
  musicCommunityForm,
  setMusicCommunityForm,
}) => {
  if (templateType === 'free-diagnosis') {
    return (
      <div className="simple-template-form">
        <p className="simple-template-form-guide">
          無料診断は「誰に・何を・どこから申し込むか」が分かれば作れます。
        </p>
        <label className="simple-form-field">
          <span className="simple-form-label">キャンペーン名 <span className="simple-form-required">必須</span></span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：はじめての無料歌唱診断 / 30秒歌声チェック"
            value={freeDiagnosisForm.campaignName}
            onChange={(e) => setFreeDiagnosisForm((p) => ({ ...p, campaignName: e.target.value }))}
          />
          <span className="simple-form-hint">動画の見出しになります。短く分かりやすい名前がおすすめです。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">対象者</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：歌を上達させたい方、ボーカル初心者"
            value={freeDiagnosisForm.targetAudience}
            onChange={(e) => setFreeDiagnosisForm((p) => ({ ...p, targetAudience: e.target.value }))}
          />
          <span className="simple-form-hint">「初心者」「独学中」「久しぶりに歌う方」など、相手が自分ごとにしやすい言葉にします。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">診断方法</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：LINEで音源を送るだけ・ZOOMで30分"
            value={freeDiagnosisForm.diagnosisMethod}
            onChange={(e) => setFreeDiagnosisForm((p) => ({ ...p, diagnosisMethod: e.target.value }))}
          />
          <span className="simple-form-hint">手順が簡単に見えるほど、申し込みやすくなります。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">LINE登録URLまたはQR案内</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：https://lin.ee/xxxxx"
            value={freeDiagnosisForm.lineUrl}
            onChange={(e) => setFreeDiagnosisForm((p) => ({ ...p, lineUrl: e.target.value }))}
          />
          <span className="simple-form-hint">未定なら空欄でも進めます。あとから編集できます。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">一言メッセージ（任意）</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：先着30名限定。気軽に申し込んでください。"
            value={freeDiagnosisForm.message}
            onChange={(e) => setFreeDiagnosisForm((p) => ({ ...p, message: e.target.value }))}
          />
        </label>
      </div>
    )
  }

  if (templateType === 'note-article') {
    return (
      <div className="simple-template-form">
        <p className="simple-template-form-guide">
          Note記事は「記事タイトル」と「読んでほしい人」を入れると、紹介動画にしやすくなります。
        </p>
        <label className="simple-form-field">
          <span className="simple-form-label">記事タイトル <span className="simple-form-required">必須</span></span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：歌が上手くなる3つの練習法 / 緊張せず歌うコツ"
            value={noteArticleForm.articleTitle}
            onChange={(e) => setNoteArticleForm((p) => ({ ...p, articleTitle: e.target.value }))}
          />
          <span className="simple-form-hint">記事の正式タイトル、またはSNSで伝えたい短いタイトルを入れます。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">記事テーマ <span className="simple-form-required">必須</span></span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：ボイトレ、歌唱力アップ、音楽学習、ライブ準備"
            value={noteArticleForm.articleTheme}
            onChange={(e) => setNoteArticleForm((p) => ({ ...p, articleTheme: e.target.value }))}
          />
          <span className="simple-form-hint">記事の中心テーマを2〜3語で入れると、動画の方向性が安定します。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">読んでほしい人</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：歌を独学で練習している方、ライブ前に不安な方"
            value={noteArticleForm.targetReader}
            onChange={(e) => setNoteArticleForm((p) => ({ ...p, targetReader: e.target.value }))}
          />
          <span className="simple-form-hint">空欄でもOKですが、入れると呼びかけが自然になります。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">記事URL</span>
          <input
            className="simple-form-input"
            type="url"
            placeholder="例：https://note.com/..."
            value={noteArticleForm.articleUrl}
            onChange={(e) => setNoteArticleForm((p) => ({ ...p, articleUrl: e.target.value }))}
          />
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">一言メッセージ（任意）</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：無料で読めます。ぜひご覧ください。"
            value={noteArticleForm.message}
            onChange={(e) => setNoteArticleForm((p) => ({ ...p, message: e.target.value }))}
          />
        </label>
      </div>
    )
  }

  if (templateType === 'youtube-video') {
    return (
      <div className="simple-template-form">
        <p className="simple-template-form-guide">
          YouTube紹介は「動画タイトル」と「見どころ」を入れると、SNSから本編へつなげやすくなります。
        </p>
        <label className="simple-form-field">
          <span className="simple-form-label">動画タイトル <span className="simple-form-required">必須</span></span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：歌声が変わる！ミックスボイス入門 / 初心者向け発声練習"
            value={youtubeVideoForm.videoTitle}
            onChange={(e) => setYoutubeVideoForm((p) => ({ ...p, videoTitle: e.target.value }))}
          />
          <span className="simple-form-hint">動画の正式タイトル、またはSNS用に短くしたタイトルを入れます。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">動画テーマ</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：ミックスボイスの練習方法、地声と裏声のつなげ方"
            value={youtubeVideoForm.videoTheme}
            onChange={(e) => setYoutubeVideoForm((p) => ({ ...p, videoTheme: e.target.value }))}
          />
          <span className="simple-form-hint">何についての動画かを短く入れます。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">見どころ</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：5分でできる簡単エクササイズ、失敗しやすいポイント解説"
            value={youtubeVideoForm.highlights}
            onChange={(e) => setYoutubeVideoForm((p) => ({ ...p, highlights: e.target.value }))}
          />
          <span className="simple-form-hint">ここがあると「続きを見たい」動画にしやすくなります。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">YouTube URL</span>
          <input
            className="simple-form-input"
            type="url"
            placeholder="例：https://youtube.com/watch?v=..."
            value={youtubeVideoForm.youtubeUrl}
            onChange={(e) => setYoutubeVideoForm((p) => ({ ...p, youtubeUrl: e.target.value }))}
          />
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">一言メッセージ（任意）</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：チャンネル登録お願いします！"
            value={youtubeVideoForm.message}
            onChange={(e) => setYoutubeVideoForm((p) => ({ ...p, message: e.target.value }))}
          />
        </label>
      </div>
    )
  }

  if (templateType === 'music-community') {
    return (
      <div className="simple-template-form">
        <p className="simple-template-form-guide">
          コミュニティ紹介は「どんな場所か」「誰に来てほしいか」を入れると伝わりやすくなります。
        </p>
        <label className="simple-form-field">
          <span className="simple-form-label">コミュニティ名 <span className="simple-form-required">必須</span></span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：MMM音楽サークル / 大人のゆるい音楽部"
            value={musicCommunityForm.communityName}
            onChange={(e) => setMusicCommunityForm((p) => ({ ...p, communityName: e.target.value }))}
          />
          <span className="simple-form-hint">動画の冒頭に出る名前です。正式名でOKです。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">活動内容</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：月2回のセッション会・オンライン交流・初心者向け練習会"
            value={musicCommunityForm.activities}
            onChange={(e) => setMusicCommunityForm((p) => ({ ...p, activities: e.target.value }))}
          />
          <span className="simple-form-hint">普段やっていることをそのまま入れればOKです。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">対象者</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：初心者歓迎、楽器を始めたい方、音楽仲間がほしい方"
            value={musicCommunityForm.targetAudience}
            onChange={(e) => setMusicCommunityForm((p) => ({ ...p, targetAudience: e.target.value }))}
          />
          <span className="simple-form-hint">「自分も参加できそう」と思える言葉を入れます。</span>
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">参加URL</span>
          <input
            className="simple-form-input"
            type="url"
            placeholder="例：https://..."
            value={musicCommunityForm.joinUrl}
            onChange={(e) => setMusicCommunityForm((p) => ({ ...p, joinUrl: e.target.value }))}
          />
        </label>
        <label className="simple-form-field">
          <span className="simple-form-label">一言メッセージ（任意）</span>
          <input
            className="simple-form-input"
            type="text"
            placeholder="例：見学だけでもOK！気軽にどうぞ。"
            value={musicCommunityForm.message}
            onChange={(e) => setMusicCommunityForm((p) => ({ ...p, message: e.target.value }))}
          />
        </label>
      </div>
    )
  }

  return null
}
