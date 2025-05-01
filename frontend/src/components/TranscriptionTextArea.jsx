export default function TranscriptionTextArea({ value, onChange }) {
    return (
      <textarea
        value={value}
        onChange={onChange}
        dir="rtl"
        className="w-full p-4 border border-[#EDEDED] rounded-xl shadow-sm min-h-[120px] text-right font-['Noto_Naskh_Arabic'] text-gray-700 focus:border-[#FFB6C1] focus:ring-2 focus:ring-[#FFB6C1] focus:outline-none transition-all"
        placeholder="Your transcription will appear here..."
      />
    );
  }