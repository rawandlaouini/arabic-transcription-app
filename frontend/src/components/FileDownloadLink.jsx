export default function FileDownloadLink({ url }) {
    return (
      <a
        href={url}
        download
        className="text-pink-400 underline mt-2 block"
      >
        Download File
      </a>
    );
  }