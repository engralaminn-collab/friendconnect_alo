import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { createSession, setSessionCookie } from "@/lib/session";

function verifyPassword(plain: string, hash: string): boolean {
  if (!plain || !hash) return false;
  const sha = crypto.createHash("sha256").update(plain).digest("hex");
  return sha === hash || plain === hash;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { login, identifier, email, username, phone, password } = body;

    const userInput = (login || identifier || email || username || phone || "").trim().toLowerCase();

    if (!userInput || !password) {
      return NextResponse.json(
        { error: "ইউজারনেম/ইমেইল এবং পাসওয়ার্ড আবশ্যক" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: userInput },
          { email: userInput },
        ],
      },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: "ভুল ইউজারনেম/ইমেইল বা পাসওয়ার্ড" },
        { status: 401 }
      );
    }

    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "ভুল পাসওয়ার্ড" },
        { status: 401 }
      );
    }

    // 1. Create database session
    const userAgent = req.headers.get("user-agent") || undefined;
    const ip = req.headers.get("x-forwarded-for") || undefined;
    const token = await createSession(user.id, { userAgent, ip });

    // 2. Set official session cookie
    await setSessionCookie(token);

    const response = NextResponse.json({
      success: true,
      message: "লগইন সফল হয়েছে!",
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
      },
      token,
    });

    // Also set fc_token for backward compatibility
    response.cookies.set("fc_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("Login Error:", error);
    return NextResponse.json(
      { error: error.message || "লগইন করা সম্ভব হয়নি" },
      { status: 500 }
    );
  }
}
