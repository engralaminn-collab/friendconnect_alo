import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, username, email, phone, password } = body;

    if (!password) {
      return NextResponse.json(
        { error: "পাসওয়ার্ড আবশ্যক" },
        { status: 400 }
      );
    }

    const rawInput = (email || phone || username || "").trim();
    if (!rawInput) {
      return NextResponse.json(
        { error: "ইমেইল, ফোন নম্বর বা ইউজারনেম দিন" },
        { status: 400 }
      );
    }

    const cleanRaw = rawInput.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const finalUsername = (username ? username.toLowerCase().replace(/[^a-z0-9_]/g, "") : cleanRaw) || "user_" + Date.now();
    const finalEmail = email ? email.toLowerCase().trim() : (rawInput.includes("@") ? rawInput.toLowerCase() : `${finalUsername}@alolabs.net`);
    const finalName = name || finalUsername;

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: finalEmail },
          { username: finalUsername },
        ],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "এই ইউজার বা ইমেইল ইতিমধ্যে নিবন্ধিত। সরাসরি লগইন করুন।" },
        { status: 400 }
      );
    }

    const passwordHash = hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name: finalName,
        username: finalUsername,
        email: finalEmail,
        passwordHash: passwordHash,
        role: "user",
        emailVerified: true,
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: "অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে! এখন লগইন করুন।",
      user,
    });
  } catch (error: any) {
    console.error("Register Error:", error);
    return NextResponse.json(
      { error: error.message || "রেজিস্ট্রেশন সম্পন্ন করা যায়নি" },
      { status: 500 }
    );
  }
}
