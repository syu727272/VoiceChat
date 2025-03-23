# OpenAI Realtime 音声会話アプリ

このアプリケーションは、OpenAI Realtime APIを使用したリアルタイム音声会話アプリケーションです。WebRTCを利用して、ユーザーの音声入力をAIに送信し、AIからの応答を音声で受け取ります。

## 機能

- リアルタイム音声会話
- 複数の音声モデル選択（alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse）
- 入力デバイスの選択と管理
- 音声波形のリアルタイム可視化
- 詳細なログ記録（録音時刻、録音時間、AIからの返事時刻、返事時間など）
- 接続状態の監視
- 会話履歴の表示

## 技術スタック

- **フロントエンド**: HTML, CSS, JavaScript（純粋なWebブラウザAPI）
- **バックエンド**: Node.js, Express
- **API**: OpenAI Realtime API
- **通信**: WebRTC
- **音声処理**: Web Audio API

## セットアップ方法

### 前提条件

- Node.js (v14以上)
- npm (v6以上)
- OpenAI APIキー

### インストール

1. リポジトリをクローンまたはダウンロードします
2. 依存関係をインストールします

```bash
npm install
```

3. `.env`ファイルを作成し、OpenAI APIキーを設定します

```
OPENAI_API_KEY="your_api_key_here"
```

### 実行方法

アプリケーションを起動するには、以下のコマンドを実行します：

```bash
npm start
```

サーバーが起動したら、ブラウザで `http://localhost:8080` にアクセスしてアプリケーションを使用できます。

## 使用方法

1. ブラウザでアプリケーションにアクセスします
2. 希望するAI音声モデルをドロップダウンから選択します
3. 使用する音声入力デバイスを選択します
4. 「Start Conversation」ボタンをクリックして会話を開始します
5. マイクに向かって話しかけると、AIが応答します
6. 会話を終了するには「End Conversation」ボタンをクリックします

## ログ情報

アプリケーションは以下の情報を記録します：

- 録音開始/終了時刻
- 録音時間
- AIからの応答時刻
- 応答時間
- 音声デバイスの接続/切断状態
- エラー情報
- メッセージID

## トラブルシューティング

### マイクへのアクセスが許可されない

ブラウザの設定でマイクへのアクセスを許可してください。Chromeの場合：
1. アドレスバーの左側にあるロックアイコンをクリック
2. 「サイトの設定」をクリック
3. マイクの設定を「許可」に変更

### 接続エラーが発生する

- インターネット接続を確認してください
- `.env`ファイル内のAPIキーが正しいことを確認してください
- サーバーログでエラーメッセージを確認してください

## ライセンス

ISCライセンスの下で公開されています。

## 謝辞

このプロジェクトは[OpenAI Realtime API](https://platform.openai.com/docs/api-reference/audio/realtime)を使用しています。
