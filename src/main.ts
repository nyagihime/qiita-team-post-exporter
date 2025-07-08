import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config()

const TEAM_ID = process.env.QIITA_TEAM
const TOKEN = process.env.QIITA_TOKEN
const BASE_URL = `https://${TEAM_ID}.qiita.com/api/v2/`
const OUTDIR = process.env.OUTDIR
const MDFILE = process.env.MDFILE

/**
 * 認証した本人の投稿を全部取得する
 * @returns 
 */
const fetchAllItems = async (): Promise<any[]> => {
    const maxPages = 50 // ページング処理の最大数（もし50ページ以上、つまり5000件以上記事がある場合は、数値を調整）

    const perPage = 100
    let page = 1
    let list: any[] = []

    while(page <= maxPages) {
        const res = await axios.get(`${BASE_URL}/authenticated_user/items`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
            params: {
                per_page: perPage,
                page
            }
        })

        if (res.data.length === 0 ) break

        list.push(...res.data)
        console.log(`page: ${page} : ${res.data.length} item(s)`)

        page++
    }

    return list
}


/**
 * 記事本文から画像パスを探す
 * @param md 
 * @returns 
 */
const extractImageUrls = (md: string): string[] => {
    let match

    // Markdown 記法用
    const  mdRegex = /!\[.*?\]\((https:\/\/.*?)\)/g
    const urls: string[] = []

    while((match =  mdRegex.exec(md)) !== null) {
        urls.push(match[1])
    }

    // HTML の img 要素用
    const htmlRegex = /<img\s+[^>]*src=["'](https:\/\/[^"'>\s]+)["']/gi;
    while ((match = htmlRegex.exec(md)) !== null) {
        urls.push(match[1]);
    }

    return urls
}

/**
 * 画像ダウンロード
 * @param url 
 * @param filePath 
 */
const downloadImage = async (url: string, filePath: string) => {
    const res = await axios.get( url, {
        headers: {
            Authorization: `Bearer ${TOKEN}`
        },
        responseType: 'arraybuffer'
    })
    fs.writeFileSync(filePath, res.data)

    console.log(`saveImage: ${filePath}`)
}

/**
 * YAML Frontmatter の生成
 * @param item 
 * @returns 
 */
const buildYamlFrontMatter = (item: any): string => {
    const tagsYML = item.tags.map((tag: any) => `   - ${tag.name}`).join('\n')
    return [
        '---',
        `title: ${item.title}`,
        `isDraft: ${item.private}`,
        `created: ${item.created_at}`,
        `modified: ${item.updated_at}`,
        'tags:',
        tagsYML,
        '---'
    ].join('\n')
}

/**
 * Markdown ファイルとして保存
 * @param item 
 * @param outDir 
 */
const savePostToMarkdown = async (item: any, outDir: string) => {
    // タイトルにはファイル名に使えない文字が入ってることがあるので、とりあえずIDベースで保存
    const itemId = item.id 
    let mdBody = item.body
    const imageUrls = extractImageUrls(mdBody)


    const frontmatter = buildYamlFrontMatter(item)

    // 画像の保存先の準備
    const imageDir = path.join(outDir, itemId, 'images')
    fs.mkdirSync(imageDir, {recursive: true})

    for (const url of imageUrls) {
        const filename = path.basename(url.split('?')[0]) // 画像URLからクエリを除去
        const localPath = `images/${filename}`
        const savePath = path.join(imageDir, filename)

        try {
            await downloadImage(url, savePath)
            mdBody = mdBody.replace(url, localPath) // 本文内の画像URLをローカルパスに書き換え
        } catch (error) {
            console.warn(`画像ダウンロード失敗： ${url}`, error)
        }
    }

    const mdPath = path.join(outDir, itemId, MDFILE ?? 'index.md')
    // Frontmatter と合体
    const fullMdData = `${frontmatter}\n${mdBody}`
    fs.writeFileSync(mdPath, fullMdData, 'utf-8')

    console.log(
        'post saved',
        `title: ${item.title}`,
        `outPath: ${mdPath}`
    )
}


const main = async ():Promise<void> => {
    if (!TEAM_ID||!TOKEN) {
        console.error('環境変数未設定エラー')
        process.exit(1)
    }

    const items = await fetchAllItems()
    const outDir = path.join(__dirname, OUTDIR ? `../${OUTDIR}` : '../export')

    // 出力先フォルダの作成
    fs.mkdirSync(outDir, { recursive: true})

    // JSON も一応とっておく
    const jsonPath = path.join(outDir, 'export.json')
    fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2), 'utf-8')


    for (const item of items) {
        await savePostToMarkdown(item, outDir)
    }
}

main().catch(console.error)