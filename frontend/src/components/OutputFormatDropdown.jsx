export default function OutputFormatDropdown({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="p-3 border border-[#EDEDED] rounded-xl shadow-sm focus:border-[#FFB6C1] focus:ring-2 focus:ring-[#FFB6C1] focus:outline-none transition-all bg-white"
    >
      <option value="PDF">PDF</option>
      <option value="Word">Word</option>
    </select>
  );
}