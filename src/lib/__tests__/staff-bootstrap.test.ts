import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: { update: vi.fn() },
  siteSetting: { findUnique: vi.fn(), upsert: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  bootstrapRoleForEmail,
  parseEmailList,
  syncBootstrapStaffRole,
} = await import("../staff-bootstrap");

describe("parseEmailList", () => {
  it("splits commas, semicolons, and whitespace", () => {
    expect(parseEmailList("A@x.com, b@x.com; C@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });
});

describe("bootstrapRoleForEmail", () => {
  it("defaults the locally granted admin and receptionist", () => {
    vi.unstubAllEnvs();
    expect(bootstrapRoleForEmail("info@recrogroup.org")).toBe("admin");
    expect(bootstrapRoleForEmail("carolinehawi91@gmail.com")).toBe(
      "receptionist",
    );
    expect(bootstrapRoleForEmail("random@example.com")).toBeNull();
  });

  it("uses env lists when they are set", () => {
    vi.stubEnv("BOOTSTRAP_ADMIN_EMAILS", "owner@recrogroup.org");
    vi.stubEnv("BOOTSTRAP_RECEPTIONIST_EMAILS", "desk@recrogroup.org");

    expect(bootstrapRoleForEmail("owner@recrogroup.org")).toBe("admin");
    expect(bootstrapRoleForEmail("info@recrogroup.org")).toBeNull();
    expect(bootstrapRoleForEmail("desk@recrogroup.org")).toBe("receptionist");

    vi.unstubAllEnvs();
  });
});

describe("syncBootstrapStaffRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("promotes a customer who is on the admin bootstrap list", async () => {
    prismaMock.user.update.mockResolvedValueOnce({ id: "u1" });

    const role = await syncBootstrapStaffRole({
      id: "u1",
      email: "info@recrogroup.org",
      role: "customer",
      emailVerified: true,
    });

    expect(role).toBe("admin");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { role: "admin" },
    });
  });

  it("corrects carolinehawi91@gmail.com from Director to receptionist", async () => {
    prismaMock.siteSetting.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValueOnce({ id: "u1" });

    const role = await syncBootstrapStaffRole({
      id: "u1",
      email: "carolinehawi91@gmail.com",
      role: "admin",
      emailVerified: true,
    });

    expect(role).toBe("receptionist");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { role: "receptionist" },
    });
  });

  it("does not promote an unverified inbox", async () => {
    const role = await syncBootstrapStaffRole({
      id: "u1",
      email: "info@recrogroup.org",
      role: "admin",
      emailVerified: false,
    });

    expect(role).toBe("customer");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { role: "customer" },
    });
  });

  it("does not restore a role that was explicitly removed", async () => {
    prismaMock.siteSetting.findUnique.mockResolvedValueOnce({
      value: JSON.stringify(["info@recrogroup.org"]),
    });

    const role = await syncBootstrapStaffRole({
      id: "u1",
      email: "info@recrogroup.org",
      role: "customer",
      emailVerified: true,
    });

    expect(role).toBe("customer");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("retires the previous super admin once", async () => {
    prismaMock.siteSetting.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValueOnce({ id: "u1" });
    prismaMock.siteSetting.upsert.mockResolvedValue({});

    const role = await syncBootstrapStaffRole({
      id: "u1",
      email: "minanicalm@gmail.com",
      role: "admin",
    });

    expect(role).toBe("customer");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { role: "customer" },
    });
  });

  it("leaves a later grant to the previous super admin in place", async () => {
    prismaMock.siteSetting.findUnique.mockResolvedValueOnce({ value: "1" });

    const role = await syncBootstrapStaffRole({
      id: "u1",
      email: "minanicalm@gmail.com",
      role: "admin",
    });

    expect(role).toBe("admin");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("leaves unlisted customers unchanged", async () => {
    const role = await syncBootstrapStaffRole({
      id: "u1",
      email: "client@example.com",
      role: "customer",
    });

    expect(role).toBe("customer");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
