import { z } from "zod";

export const xhsWebLogin = {
  home: "https://creator.xiaohongshu.com/",
  login: "https://creator.xiaohongshu.com/login",
  identity: "https://creator.xiaohongshu.com/api/galaxy/user/info",
};
export type WebLoginState =
  | "not_logged_in"
  | "waiting"
  | "saved"
  | "logged_in"
  | "expired"
  | "network_error"
  | "unconfirmed"
  | "account_mismatch";
export type WebLoginStatus = {
  projectId: string;
  accountId: string;
  platform: "xiaohongshu";
  state: WebLoginState;
  message: string;
  userId?: string;
  userName?: string;
  checkedAt?: string;
  windowOpen: boolean;
};
export function webLoginPartition(projectId: string, accountId: string) {
  return `persist:workbench-xhs-${z.uuid().parse(projectId)}-${z.uuid().parse(accountId)}`;
}
export function allowedLoginNavigation(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "creator.xiaohongshu.com",
        "www.xiaohongshu.com",
        "passport.xiaohongshu.com",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
// This is the creator website's own read-only identity response, not a publishing API.
// A cookie, URL change, or cached profile alone never proves authentication.
export function xhsIdentity(
  status: number,
  body: unknown,
): Pick<WebLoginStatus, "state" | "message" | "userId" | "userName"> {
  const result = z
    .object({
      success: z.boolean().optional(),
      result: z.number().optional(),
      data: z.unknown().optional(),
    })
    .safeParse(body);
  if (status === 401 || (result.success && result.data.result === -100))
    return {
      state: "not_logged_in",
      message: "请在小红书官方页面扫码或使用手机号登录",
    };
  if (status === 429)
    return {
      state: "unconfirmed",
      message: "小红书暂时限制检查频率，请稍后再检查",
    };
  if (status >= 500)
    return {
      state: "network_error",
      message: "小红书服务暂不可用，登录会话仍保留",
    };
  if (status === 200 && result.success && result.data.success === true) {
    const identity = z
      .object({
        userId: z.string().trim().min(1).max(128),
        userName: z.string().max(200).optional(),
        nickname: z.string().max(200).optional(),
        name: z.string().max(200).optional(),
      })
      .safeParse(result.data.data);
    if (identity.success)
      return {
        state: "logged_in",
        message: "已通过小红书官方页面身份检查",
        userId: identity.data.userId,
        userName:
          identity.data.userName ??
          identity.data.nickname ??
          identity.data.name,
      };
  }
  return {
    state: "unconfirmed",
    message: "暂时无法确认登录状态，请打开官方页面完成验证后重试",
  };
}
