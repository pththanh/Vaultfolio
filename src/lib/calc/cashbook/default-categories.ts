import type { CategoryKind } from "./types";

export const BANK_FEE_CATEGORY = "Phí ngân hàng";
export const LOAN_INTEREST_CATEGORY = "Lãi vay";
export const LEND_INTEREST_CATEGORY = "Lãi cho vay";

export interface DefaultCategory {
  kind: CategoryKind;
  name: string;
  icon: string;
  color: string;
  isSystem?: boolean;
  children?: { name: string; isSystem?: boolean }[];
}

const expense = (
  name: string,
  icon: string,
  color: string,
  ...children: (string | { name: string; isSystem: boolean })[]
): DefaultCategory => ({
  kind: "expense",
  name,
  icon,
  color,
  children: children.map((c) => (typeof c === "string" ? { name: c } : c)),
});

const system = (name: string) => ({ name, isSystem: true });

/** docs/CONTEXT.md §13.6 */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  expense(
    "Ăn uống",
    "🍜",
    "#C0632B",
    "Đi chợ/siêu thị",
    "Ăn ngoài",
    "Cà phê/đồ uống",
    "Ăn vặt",
  ),
  expense(
    "Đi lại",
    "🛵",
    "#2547B8",
    "Xăng xe",
    "Gửi xe",
    "Taxi/Grab",
    "Vé tàu xe/máy bay",
    "Bảo dưỡng/sửa xe",
    "Bảo hiểm xe",
    "Phí cầu đường",
  ),
  expense(
    "Nhà cửa & hoá đơn",
    "🏠",
    "#3B8A45",
    "Tiền nhà",
    "Điện",
    "Nước",
    "Internet",
    "Điện thoại",
    "Gas",
    "Phí quản lý",
    "Sửa chữa/đồ gia dụng",
  ),
  expense(
    "Mua sắm",
    "🛍️",
    "#A23B72",
    "Quần áo",
    "Giày dép/phụ kiện",
    "Đồ điện tử",
    "Mỹ phẩm",
  ),
  expense(
    "Sức khoẻ",
    "💊",
    "#008B92",
    "Khám chữa bệnh",
    "Thuốc",
    "Bảo hiểm sức khoẻ/nhân thọ",
    "Thể thao",
  ),
  expense(
    "Học tập & phát triển",
    "📚",
    "#5B4BB3",
    "Học phí",
    "Sách",
    "Khoá học",
  ),
  expense("Con cái", "🧸", "#B5791C", "Sữa/bỉm", "Học phí con", "Đồ chơi"),
  expense(
    "Giải trí & du lịch",
    "🎬",
    "#7A3E9D",
    "Du lịch",
    "Phim/sự kiện",
    "Ứng dụng & dịch vụ đăng ký",
  ),
  expense(
    "Hiếu hỉ & quà",
    "🎁",
    "#B8456A",
    "Đám cưới",
    "Ma chay",
    "Quà tặng",
    "Từ thiện",
  ),
  expense("Gia đình", "👪", "#2B72B0", "Biếu bố mẹ", "Người giúp việc"),
  expense(
    "Phí & lãi",
    "🧾",
    "#5B6270",
    system(BANK_FEE_CATEGORY),
    system(LOAN_INTEREST_CATEGORY),
    "Thuế & lệ phí",
  ),
  expense("Khác", "📦", "#8A909B"),
  { kind: "income", name: "Lương", icon: "💼", color: "#0B7A47" },
  { kind: "income", name: "Thưởng", icon: "🏆", color: "#B5791C" },
  {
    kind: "income",
    name: "Thu nhập phụ/freelance",
    icon: "💻",
    color: "#2547B8",
  },
  { kind: "income", name: "Được cho/tặng", icon: "🎁", color: "#B8456A" },
  { kind: "income", name: "Hoàn tiền/cashback", icon: "↩️", color: "#008B92" },
  { kind: "income", name: "Bán đồ cũ", icon: "🏷️", color: "#C0632B" },
  {
    kind: "income",
    name: LEND_INTEREST_CATEGORY,
    icon: "🤝",
    color: "#5B4BB3",
    isSystem: true,
  },
  { kind: "income", name: "Khác", icon: "📥", color: "#8A909B" },
];
