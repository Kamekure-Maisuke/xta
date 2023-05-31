import {
  crypto,
  toHashString,
} from "https://deno.land/std@0.190.0/crypto/mod.ts";

/**
 * 指定したパスワードが形式通りか確認する。
 * 文字数 : 10文字以上64文字以下
 * 種類 : アルファベット大文字小文字・数字・ピリオド・スラッシュ・クエスチョン
 * @param target パスワード
 * @returns
 */
export function isPassword(target: string): boolean {
  const regex = new RegExp(/^[a-zA-Z0-9.?/-]{10,64}$/);
  return regex.test(target);
}

/**
 * 与えられた文字列を指定回数ストレッチングしたSHA3-384ハッシュに変換
 * @param target ハッシュ変換対象
 * @returns
 */
export async function createPasswordHash(target: string): Promise<string> {
  let result = target;
  const encoder = new TextEncoder();
  for (let i = 0; i < 5000; i++) {
    const hash = await crypto.subtle.digest("SHA3-384", encoder.encode(result));
    result = toHashString(hash);
  }
  return result;
}
