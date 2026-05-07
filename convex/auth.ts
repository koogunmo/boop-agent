import { convexAuth } from "@convex-dev/auth/server";
import { Phone } from "@convex-dev/auth/providers/Phone";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { internal } from "./_generated/api";

function generateOTP(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0]! % 1000000).padStart(6, "0");
}

function normalizeE164(n: string): string {
  const parsed = parsePhoneNumberFromString(n, "US");
  if (!parsed) throw new Error(`Invalid phone number: ${n}`);
  return parsed.format("E.164");
}

const SendblueOTP = Phone({
  id: "sendblue-otp",
  maxAge: 60 * 10,
  async generateVerificationToken() {
    return generateOTP();
  },
  async sendVerificationRequest({ identifier: phone, token }, ctx) {
    const normalized = normalizeE164(phone);
    const allowed = process.env.ALLOWED_PHONE;
    if (allowed && normalized !== normalizeE164(allowed)) {
      throw new Error("Unauthorized phone number");
    }
    await ctx.runAction(internal.authActions.sendOTP, { phone: normalized, code: token });
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [SendblueOTP],
});
