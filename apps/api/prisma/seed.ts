import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/services/password.js';

const prisma = new PrismaClient();

function mulberry32(seed: number) {
  return function rng() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260610);
function ago(days: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  await prisma.$transaction([
    prisma.followUp.deleteMany(),
    prisma.pharmacyAccessLog.deleteMany(),
    prisma.pharmacyCustomer.deleteMany(),
    prisma.inviteCode.deleteMany(),
    prisma.pharmacyStaff.deleteMany(),
    prisma.pharmacy.deleteMany(),
    prisma.dailySummary.deleteMany(),
    prisma.glucoseRecord.deleteMany(),
    prisma.bpRecord.deleteMany(),
    prisma.lipidRecord.deleteMany(),
    prisma.uricRecord.deleteMany(),
    prisma.user.deleteMany(),
    prisma.adminUser.deleteMany()
  ]);

  const [kn, bxy] = await Promise.all([
    prisma.pharmacy.create({ data: { name: '康宁大药房 · 中山路店', address: '中山路 128 号', phone: '0571-8765 4321' } }),
    prisma.pharmacy.create({ data: { name: '百姓缘药房 · 解放路店', address: '解放路 56 号', phone: '0571-8123 9876' } })
  ]);
  const [owner, staff, bxyOwner] = await Promise.all([
    prisma.pharmacyStaff.create({ data: { pharmacyId: kn.id, username: 'kangning', passwordHash: await hashPassword('Kn@123456'), name: '王建国', role: 'owner' } }),
    prisma.pharmacyStaff.create({ data: { pharmacyId: kn.id, username: 'kn_li', passwordHash: await hashPassword('Kn@123456'), name: '李雯', role: 'staff' } }),
    prisma.pharmacyStaff.create({ data: { pharmacyId: bxy.id, username: 'baixingyuan', passwordHash: await hashPassword('Bxy@123456'), name: '赵敏', role: 'owner' } })
  ]);
  void owner;
  void bxyOwner;

  const invite = await prisma.inviteCode.create({
    data: { pharmacyId: kn.id, staffId: staff.id, code: 'KN23DEMO', expiresAt: ago(-30, 0, 0) }
  });

  const demo = await prisma.user.create({
    data: { openid: 'seed_demo', nickname: '微信用户_8462', sex: 'male' }
  });
  await prisma.pharmacyCustomer.create({ data: { pharmacyId: kn.id, userId: demo.id, inviteCodeId: invite.id, consentAt: ago(12, 10, 30) } });

  await prisma.glucoseRecord.createMany({
    data: [
      { userId: demo.id, valueMmol: 6.1, period: 'fasting', measuredAt: ago(0, 6, 52), tags: '[]', note: '' },
      { userId: demo.id, valueMmol: 8.2, period: 'after_breakfast', measuredAt: ago(0, 9, 26), tags: '[]', note: '燕麦 + 鸡蛋' },
      { userId: demo.id, valueMmol: 11.2, period: 'after_lunch', measuredAt: ago(0, 13, 47), tags: '["聚餐"]', note: '同事聚餐，米饭偏多' }
    ]
  });
  await prisma.bpRecord.createMany({
    data: [
      { userId: demo.id, sbp: 178, dbp: 106, pulse: 88, period: 'evening', measuredAt: ago(2, 20, 12), tags: '["情绪波动"]', note: '' },
      { userId: demo.id, sbp: 186, dbp: 112, pulse: 91, period: 'morning', measuredAt: ago(1, 7, 18), tags: '[]', note: '晨起头有点胀' },
      { userId: demo.id, sbp: 138, dbp: 86, pulse: 76, period: 'morning', measuredAt: ago(0, 7, 5), tags: '["服药后"]', note: '' }
    ]
  });
  await prisma.lipidRecord.createMany({
    data: [
      { userId: demo.id, tc: 6.4, tg: 2.6, ldl: 4.3, hdl: 0.9, fasting: true, measuredAt: ago(85, 8, 30), note: '' },
      { userId: demo.id, tc: 5.9, tg: 2.1, ldl: 3.9, hdl: 1.0, fasting: true, measuredAt: ago(45, 8, 30), note: '' },
      { userId: demo.id, tc: 5.4, tg: 1.8, ldl: 3.5, hdl: 1.1, fasting: true, measuredAt: ago(8, 8, 30), note: '' }
    ]
  });
  await prisma.uricRecord.createMany({
    data: [80, 60, 40, 20, 6].map((d, i) => ({
      userId: demo.id,
      value: [470, 455, 440, 432, 418][i]!,
      fasting: true,
      measuredAt: ago(d, 8, 40),
      note: ''
    }))
  });

  const names = ['陈阿姨', '老周', '林女士', '吴先生', '小郑', '孙阿姨', '老何', '苏女士', '大刘', '方先生'];
  for (let i = 0; i < names.length; i += 1) {
    const user = await prisma.user.create({
      data: { openid: `seed_customer_${i + 1}`, nickname: names[i]!, sex: i % 2 === 0 ? 'female' : 'male' }
    });
    const pharmacyId = i < 8 ? kn.id : bxy.id;
    await prisma.pharmacyCustomer.create({ data: { pharmacyId, userId: user.id, consentAt: ago(5 + i, 14, 0) } });
    for (let day = 30; day >= 1; day -= 1) {
      if ((i === 8 || i === 9) && day <= 7) continue;
      if (rng() < 0.45) {
        await prisma.glucoseRecord.create({
          data: {
            userId: user.id,
            valueMmol: Number((6 + rng() * 5).toFixed(1)),
            period: rng() > 0.5 ? 'fasting' : 'after_lunch',
            measuredAt: ago(day, rng() > 0.5 ? 7 : 13, Math.floor(rng() * 50)),
            tags: '[]',
            note: ''
          }
        });
      }
      if (rng() < 0.35) {
        const sbp = 125 + Math.floor(rng() * 25);
        await prisma.bpRecord.create({
          data: {
            userId: user.id,
            sbp,
            dbp: Math.min(sbp - 12, 75 + Math.floor(rng() * 15)),
            pulse: 68 + Math.floor(rng() * 12),
            period: 'morning',
            measuredAt: ago(day, 7, Math.floor(rng() * 50)),
            tags: '[]',
            note: ''
          }
        });
      }
    }
    if (i === 1) await prisma.glucoseRecord.create({ data: { userId: user.id, valueMmol: 17.8, period: 'after_dinner', measuredAt: ago(3, 20, 15), tags: '["聚餐"]', note: '' } });
    if (i === 4) await prisma.bpRecord.create({ data: { userId: user.id, sbp: 184, dbp: 110, pulse: 90, period: 'evening', measuredAt: ago(2, 21, 5), tags: '[]', note: '' } });
    if (i === 6) await prisma.uricRecord.create({ data: { userId: user.id, value: 560, fasting: true, measuredAt: ago(4, 8, 20), note: '' } });
  }

  await prisma.adminUser.create({
    data: {
      username: 'admin',
      passwordHash: await hashPassword(process.env.ADMIN_INIT_PASSWORD ?? 'Admin@123456')
    }
  });

  console.log('Seeded Tangji demo data');
}

main().finally(async () => {
  await prisma.$disconnect();
});
