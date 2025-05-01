export default function GenerateFileButton({ onClick, disabled }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className="bg-pink-400 text-white py-2 px-4 rounded-xl hover:bg-pink-500 disabled:bg-gray-300"
      >
        Generate File
      </button>
    );
  }