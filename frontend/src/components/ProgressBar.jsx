export default function ProgressBar({ value }) {
    return (
      <div className="w-full bg-gray-200 rounded-full h-2.5 mt-4">
        <div
          className="bg-pink-400 h-2.5 rounded-full"
          style={{ width: `${value}%` }}
        ></div>
      </div>
    );
  }