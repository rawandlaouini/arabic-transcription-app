export default function AudioUploader({ onFileSelect }) {
    return (
      <div className="flex flex-col">
        <label className="mb-2 font-medium text-gray-700">Upload Audio 🎵</label>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => onFileSelect(e.target.files[0])}
          className="p-3 border rounded-xl shadow-md focus:border-pink-400"
        />
      </div>
    );
  }