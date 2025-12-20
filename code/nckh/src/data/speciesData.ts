export interface SpeciesData {
  id: string;
  name: string;
  scientificName: string;
  category: string;
  habitat: string;
  diet: string;
  description: string;
  image: string;
  conservationStatus?: string;
  characteristics?: string[];
  distribution?: string;
  threats?: string[];
}

// Load species data từ file JSON có sẵn
let cachedSpeciesData: Record<string, any> | null = null;

export async function loadSpeciesData(): Promise<Record<string, any>> {
  if (cachedSpeciesData) {
    return cachedSpeciesData as Record<string, any>;
  }
  
  try {
    const response = await fetch('/species_info_normalized.json');
    cachedSpeciesData = await response.json();
    return cachedSpeciesData as Record<string, any>;
  } catch (error) {
    console.error('Error loading species data:', error);
    return {};
  }
}

// Tạo data từ normalized species info với format phù hợp cho SpeciesDetail
export function createSpeciesData(normalizedData: any): SpeciesData {
  return {
    id: normalizedData.id || '',
    name: normalizedData.name || 'Không rõ',
    scientificName: normalizedData.scientific || 'Chưa xác định',
    category: normalizedData.category || 'Chưa phân loại',
    habitat: normalizedData.habitat || 'Chưa có thông tin về môi trường sống',
    diet: normalizedData.diet || 'Chưa có thông tin về thức ăn',
    description: normalizedData.description || 'Chưa có mô tả chi tiết về loài này.',
    image: normalizedData.image || '/images/default.jpg',
    conservationStatus: normalizedData.conservationStatus || 'Chưa đánh giá',
    characteristics: normalizedData.characteristics || [
      'Thông tin đặc điểm đang được cập nhật'
    ],
    distribution: normalizedData.distribution || 'Khu vực U Minh Hạ, Việt Nam',
    threats: normalizedData.threats || [
      'Mất môi trường sống',
      'Biến đổi khí hậu',
      'Hoạt động con người'
    ]
  };
}

// Database mẫu cho các loài đặc biệt (có thông tin chi tiết)
export const featuredSpecies: Record<string, SpeciesData> = {
  "te_te": {
    id: "te_te",
    name: "Tê tê",
    scientificName: "Manis javanica",
    category: "Thú",
    habitat: "Rừng nhiệt đới, rừng tre nứa, vùng đồi núi thấp",
    diet: "Kiến và mối (ăn khoảng 70 triệu con/năm)",
    description: "Tê tê là loài động vật có vú duy nhất trên thế giới có vảy bảo vệ cơ thể. Chúng có lưỡi dài dính để bắt kiến và mối. Khi bị đe dọa, tê tê cuộn tròn thành quả cầu để tự vệ.",
    image: "/assets/te-te-java.webp",
    conservationStatus: "Cực kỳ nguy cấp (CR) - IUCN Red List",
    characteristics: [
      "Cơ thể phủ vảy sừng keratin",
      "Lưỡi dài có thể lên tới 40cm",
      "Không có răng",
      "Móng vuốt sắc nhọn để đào hang",
      "Hoạt động về đêm"
    ],
    distribution: "Đông Nam Á, bao gồm Việt Nam, Thái Lan, Malaysia, Indonesia",
    threats: [
      "Săn bắt trái phép để lấy vảy và thịt",
      "Mất môi trường sống do phá rừng",
      "Buôn bán động vật hoang dã bất hợp pháp"
    ]
  }
};
