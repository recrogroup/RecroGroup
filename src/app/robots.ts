import type { MetadataRoute } from "next";

function origin() {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    "https://recrogroup.org";
  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "");
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/dashboard", "/api/", "/login", "/forgot-password"],
      },
    ],
    sitemap: `${origin()}/sitemap.xml`,
  };
}

//testings 
