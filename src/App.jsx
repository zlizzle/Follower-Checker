import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { Shield, Upload, Users, UserCheck, UserX, Copy, Download, RefreshCw, ExternalLink, Heart, Github, Coffee, X, Search, Check, AlertCircle, Folder, Filter, Info, Lock } from 'lucide-react'
import { FixedSizeList as List } from 'react-window'
import JSZip from 'jszip'

const MAX_FILE_SIZE_MB = 5; // 5MB per file
const MAX_TOTAL_ENTRIES = 20000; // 10k per file, 20k total
const COOLDOWN_MS = 2000;
const ALLOWED_FILE_TYPES = ['.json'];
const BATCH_SIZE = 1000; // Process users in batches
const FOLLOWERS_PREFIX = 'followers_';
const FOLLOWING_FILE = 'following.json';
const EXPORT_FOLDER = 'followers_and_following';
const ERROR_FOLDER_DROP = "It looks like you dragged a folder. For privacy reasons, browsers only allow folder uploads using the 'browse files' button. Please click 'browse files' and select your folder, or drag the inner 'followers_and_following' folder instead.";

// Simple debounce implementation
function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// File filtering utilities
const isFollowingFile = (file) => file.name === FOLLOWING_FILE;
const isFollowersFile = (file) => {
  // Match followers_1.json, followers_2.json, etc.
  const match = file.name.match(/^followers_\d+\.json$/);
  return match !== null;
};
const isValidFile = (file) => isFollowingFile(file) || isFollowersFile(file);

// Helper to find valid files in a directory structure
const findValidFiles = (files) => {
  const validFiles = [];
  for (const file of files) {
    const path = file.name;
    if (
      file.name === 'following.json' ||
      /^followers_\d+\.json$/.test(file.name) ||
      file.name.endsWith('.zip')
    ) {
      validFiles.push(file);
    }
  }
  return validFiles;
};

// Helper to process Instagram JSON data
const processInstagramData = async (file) => {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    // Log the data structure for debugging
    console.log('Processing file:', file.name, 'Type:', Array.isArray(data) ? 'array' : typeof data, 'Keys:', Array.isArray(data) ? undefined : Object.keys(data));
    
    // Check for Instagram's data structure
    if (isFollowingFile(file)) {
      if (!data.relationships_following || !Array.isArray(data.relationships_following)) {
        console.error('Invalid following data structure:', data);
        throw new Error('Invalid following data format');
      }
    } else if (isFollowersFile(file)) {
      if (!Array.isArray(data)) {
        console.error('Invalid followers data structure:', data);
        throw new Error('Invalid followers data format');
      }
      // Debug: log the first item
      console.log('Sample followers item:', data[0]);
    }
    
    return data;
  } catch (e) {
    console.error('Error processing file:', file.name, e);
    if (e instanceof SyntaxError) {
      throw new Error(`Could not parse ${file.name}. Make sure it's a valid JSON file.`);
    }
    throw new Error(`Could not process ${file.name}. Make sure it's a valid Instagram export file.`);
  }
};

// Helper to extract files from ZIP
const extractFilesFromZip = async (zip) => {
  const validFiles = [];
  const jsonFiles = Object.keys(zip.files).filter(path => path.endsWith('.json'));
  
  console.log('Found JSON files in zip:', jsonFiles);
  
  for (const path of jsonFiles) {
    try {
      const fileData = await zip.files[path].async('blob');
      const fileName = path.split('/').pop();
      const file = new File([fileData], fileName, { type: 'application/json' });
      
      // Log file details for debugging
      console.log('Checking file:', fileName, 'isValid:', isValidFile(file));
      
      if (isValidFile(file)) {
        validFiles.push(file);
      }
    } catch (e) {
      console.error('Error extracting file from zip:', path, e);
    }
  }
  
  return validFiles;
};

function App() {
  console.log('App component mounted');
  
  // Error handling states
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  // State for upload
  const [uploadedFileCount, setUploadedFileCount] = useState(0);

  // Cleanup Tool states
  const [showCleanupTool, setShowCleanupTool] = useState(false);
  const [followingList, setFollowingList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false);

  // File states
  const [followersFile, setFollowersFile] = useState(null);
  const [followingFile, setFollowingFile] = useState(null);
  const [results, setResults] = useState(null);
  const [checkedUsers, setCheckedUsers] = useState(new Set());
  const [showInstructions, setShowInstructions] = useState(false);
  const [activeTab, setActiveTab] = useState('desktop');
  const [toast, setToast] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const [cooldown, setCooldown] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [uploadGlow, setUploadGlow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Animation state for results and mobile section
  const [showMobileSection, setShowMobileSection] = useState(false);
  const [mobileSectionRef, setMobileSectionRef] = useState(null);

  const [showTooltip, setShowTooltip] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Add fade-in state for instructions
  const [showInstructionsFade, setShowInstructionsFade] = useState(false);

  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [showIphoneTip, setShowIphoneTip] = useState(false);

  // Add scroll to results after upload
  const resultsRef = useRef(null);
  useEffect(() => {
    if (results && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [results]);

  useEffect(() => {
    if (results) setShowResults(true);
    else setShowResults(false);
  }, [results]);

  // Animate mobile section on scroll into view
  useEffect(() => {
    const handleScroll = () => {
      if (!mobileSectionRef || !mobileSectionRef.current) return;
      const rect = mobileSectionRef.current.getBoundingClientRect();
      if (rect.top < window.innerHeight - 100) setShowMobileSection(true);
    };
    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Add glow effect on successful upload
  useEffect(() => {
    if (results) {
      setUploadGlow(true);
      const timeout = setTimeout(() => setUploadGlow(false), 1200);
      return () => clearTimeout(timeout);
    }
  }, [results]);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    // Fade in on page load
    setTimeout(() => setShowInstructionsFade(true), 200);
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleFileUpload = useCallback(async (files) => {
    if (!files?.length) return;
    
    console.log('Processing files:', Array.from(files).map(f => f.name));
    setIsProcessing(true);
    setError(null);
    setWarning(null);
    setIsLoadingFollowing(true);
    
    try {
      let validFiles = [];
      
      // Check for .zip file
      if (files.length === 1 && files[0].name.endsWith('.zip')) {
        console.log('Processing zip file:', files[0].name);
        const zip = await JSZip.loadAsync(files[0]);
        validFiles = await extractFilesFromZip(zip);
        
        if (validFiles.length === 0) {
          throw new Error('We couldn\'t find the follower or following files inside your upload. Make sure the Instagram export is unzipped or structured like your original download.');
        }
      } else {
        // Handle individual file upload
        console.log('Processing individual files');
        const newFiles = Array.from(files);
        validFiles = findValidFiles(newFiles);
        if (validFiles.length === 0) {
          throw new Error('We couldn\'t find the follower or following files inside your upload. Make sure the Instagram export is unzipped or structured like your original download.');
        }
      }
      
      console.log('Valid files found:', validFiles.map(f => f.name));
      
      // Separate following and followers files
      const followingFiles = validFiles.filter(isFollowingFile);
      const followersFiles = validFiles.filter(isFollowersFile);
      
      console.log('Following files:', followingFiles.map(f => f.name));
      console.log('Followers files:', followersFiles.map(f => f.name));
      
      // Check for missing files
      if (!followingFiles.length) {
        throw new Error('We need your following.json file to compare.');
      }
      if (!followersFiles.length) {
        throw new Error('We need at least one followers_1.json file to compare.');
      }
      
      // Process files
      let following = [];
      let followers = [];
      
      // Process following file
      const followingData = await processInstagramData(followingFiles[0]);
      // following.json is an object with relationships_following array
      following = deduplicateUsernames(
        followingData.relationships_following.flatMap(item =>
          Array.isArray(item.string_list_data)
            ? item.string_list_data.map(entry => entry.value)
            : []
        )
      );
      setFollowingList(following);
      
      // Process followers files
      for (const file of followersFiles) {
        const data = await processInstagramData(file);
        // followers_1.json is an array of objects with string_list_data arrays
        const theseFollowers = data.flatMap(item =>
          Array.isArray(item.string_list_data)
            ? item.string_list_data.map(entry => entry.value)
            : []
        );
        followers = [...followers, ...theseFollowers];
      }
      
      // Check for empty states
      if (!following.length) {
        setResults({ notFollowingBack: [], message: 'You aren\'t following anyone yet. Nothing to check here.' });
        return;
      }
      
      if (!followers.length) {
        setResults({ notFollowingBack: [], message: 'No one follows you yet. Clean slate, clean feed.' });
        return;
      }
      
      // Check for incomplete followers upload
      if (following.length > 1000 && followersFiles.length === 1) {
        setWarning('You may have multiple followers files. Try uploading followers_2.json, followers_3.json, etc. for full results.');
      }
      
      // Compare lists
      const notFollowingBack = following.filter(user => !followers.includes(user));
      const youDontFollowBack = followers.filter(user => !following.includes(user));
      
      if (notFollowingBack.length === 0 && youDontFollowBack.length === 0) {
        setResults({
          notFollowingBack: [],
          youDontFollowBack: [],
          message: "Everyone you follow follows you back, and you follow everyone who follows you. That's a perfect match! Your Instagram circle is in total harmony.",
          subtext: "Nice work! Looks like you keep your connections intentional and mutual."
        });
      } else if (notFollowingBack.length === 0) {
        setResults({
          notFollowingBack: [],
          youDontFollowBack,
          message: "Everyone you follow follows you back. Your circle is complete!",
          subtext: "No loose ends here. You're keeping it mutual."
        });
      } else if (youDontFollowBack.length === 0) {
        setResults({
          notFollowingBack,
          youDontFollowBack: [],
          message: "You follow some people who don't follow you back.",
          subtext: "Scroll down to see who they are."
        });
      } else {
        setResults({ notFollowingBack, youDontFollowBack });
      }
      
    } catch (err) {
      console.error('Error processing files:', err);
      setError(err.message);
      setResults(null);
      setFollowingList([]);
    } finally {
      setIsProcessing(false);
      setIsLoadingFollowing(false);
    }
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  useEffect(() => {
    const onGlobalDrop = (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length === 0) {
        e.preventDefault();
        setError(ERROR_FOLDER_DROP);
        setTimeout(() => setError(null), 7000);
      }
    };
    window.addEventListener('drop', onGlobalDrop);
    return () => window.removeEventListener('drop', onGlobalDrop);
  }, []);

  const handleDrop = (e) => {
    console.log('Drop event fired', e);
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    console.log('Dropped files:', files.map(f => f.name));
    // Only allow .zip and .json files
    const hasZip = files.some(f => f.name.endsWith('.zip'));
    const hasJson = files.some(f => f.name.endsWith('.json'));
    if (!hasZip && !hasJson) {
      setError('Please upload your Instagram zip file or the JSON files named following.json and followers_1.json, followers_2.json, and so on.');
      setTimeout(() => setError(null), 7000);
      return;
    }
    handleFileUpload(files);
  };

  const handleFileSelect = (e) => {
    const files = e.target.files;
    console.log('Selected files:', Array.from(files).map(f => f.name));
    handleFileUpload(files);
  };

  const toggleUserChecked = (username) => {
    const newChecked = new Set(checkedUsers)
    if (newChecked.has(username)) {
      newChecked.delete(username)
    } else {
      newChecked.add(username)
    }
    setCheckedUsers(newChecked)
  }

  // Debounced handlers
  const debouncedCopyUsernames = useMemo(
    () => debounce((usernames) => {
      navigator.clipboard.writeText(usernames.join('\n'))
      showToast('Usernames copied to clipboard!')
    }, 300),
    []
  );

  const debouncedDownloadCSV = useMemo(
    () => debounce((data, filename) => {
      const csv = ['Username,Instagram URL\n']
      data.forEach(username => {
        csv.push(`${username},https://instagram.com/${username}\n`)
      })
      
      const blob = new Blob([csv.join('')], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      showToast('CSV downloaded!')
    }, 300),
    []
  );

  // Memoized list data
  const notFollowingBackList = useMemo(() => {
    if (!results?.notFollowingBack) return [];
    return results.notFollowingBack;
  }, [results?.notFollowingBack]);

  const youDontFollowBackList = useMemo(() => {
    if (!results?.youDontFollowBack) return [];
    return results.youDontFollowBack;
  }, [results?.youDontFollowBack]);

  // Optimized row renderer
  const VirtualizedRow = useCallback(({ data, index, style, type, checkedUsers, toggleUserChecked }) => {
    const username = data[index];
    return (
      <div style={style} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center min-w-0 flex-1">
          <input
            type="checkbox"
            checked={checkedUsers.has(username)}
            onChange={() => toggleUserChecked(username)}
            className="mr-3 rounded border-gray-300 text-purple-600 focus:ring-purple-500 flex-shrink-0"
          />
          <a
            href={`https://instagram.com/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 hover:text-purple-700 font-medium flex items-center min-w-0"
          >
            <span className="truncate">@{username}</span>
          </a>
        </div>
      </div>
    );
  }, []);

  const openNextProfile = (usernames, startIndex = 0) => {
    const uncheckedUsers = usernames.filter(username => !checkedUsers.has(username))
    if (uncheckedUsers.length > 0) {
      window.open(`https://instagram.com/${uncheckedUsers[0]}`, '_blank')
    }
  }

  const resetApp = () => {
    setFollowersFile(null)
    setFollowingFile(null)
    setResults(null)
    setCheckedUsers(new Set())
    setShowInstructions(false)
    setIsProcessing(false)
  }

  const getProgressText = () => {
    if (!results) return ''
    const total = results.notFollowingBack.length + results.youDontFollowBack.length
    const checked = checkedUsers.size
    return `You've cleaned up ${checked} of ${total} connections`
  }

  // Copy steps text
  const stepsText = `How to Download Your Instagram Data\n\n1. Go to your Instagram settings: Settings and activity → Accounts Center\n2. Tap or click: Your information and permissions → Download your information\n3. Select: Download or transfer information → Some of your information\n4. Scroll down and check only: Connections → Followers and Following\n5. Tap Next, then set:\n   - Format: JSON\n   - Destination: Download to device\n6. Tap Create files (Instagram will prepare the download)\n\nFinal Step – Upload Your Files:\n- Unzip the file\n- Open the folder: followers_and_following/\n- Upload these files here:\n  - following.json\n  - followers_1.json\n  - (optional) followers_2.json, followers_3.json, etc.\n\nThis is 100% private. Everything stays on your device.`;

  const handleCopySteps = async () => {
    try {
      await navigator.clipboard.writeText(stepsText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopySuccess(false);
    }
  };

  // Utility functions for file validation
  const validateFileType = (file) => {
    if (!file.name.endsWith('.json')) {
      throw new Error('It looks like this isn\'t a JSON file. Make sure to select JSON format when downloading your data from Instagram.');
    }
    return true;
  };

  const validateFileContent = async (file) => {
    try {
      const text = await file.text();
      if (!text || text.trim() === '') {
        throw new Error('Something went wrong. One or more files appear empty or unreadable. Make sure you chose the JSON format from Instagram when exporting.');
      }
      const data = JSON.parse(text);
      return data;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error('Something went wrong. One or more files appear empty or unreadable. Make sure you chose the JSON format from Instagram when exporting.');
      }
      throw e;
    }
  };

  const validateInstagramFormat = (data) => {
    const hasFollowing = data.relationships_following?.string_list_data?.value;
    const hasFollowers = data.relationships_followers?.string_list_data?.value;
    
    if (!hasFollowing && !hasFollowers) {
      throw new Error('These files do not look like real Instagram exports. Please upload files directly from Instagram\'s download tool.');
    }
    return true;
  };

  const deduplicateUsernames = (usernames) => {
    const unique = [...new Set(usernames)];
    if (unique.length !== usernames.length) {
      setWarning('We cleaned up a few duplicates before comparing.');
    }
    return unique;
  };

  // On successful upload, clear error
  useEffect(() => {
    if (results) setError(null);
  }, [results]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-gray-900/80 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-teal-400">FollowCheck</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto py-24 px-6">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">See who's not following you back</h1>
          {/* Privacy-first reassurance */}
          <div className="flex flex-col items-center gap-2 mb-4">
            <div className="text-base text-green-400 font-medium">Your data never leaves your device.</div>
            <div className="text-sm text-gray-400">We don't track you, collect anything, or send files anywhere.</div>
            {/* Visual privacy badge */}
            <div className="flex flex-col sm:flex-row items-center gap-2 mt-2">
              <span className="flex items-center gap-1 bg-gray-800 text-green-400 px-3 py-1 rounded-full text-xs font-semibold border border-green-700">
                <Lock className="w-4 h-4 inline-block mr-1 text-green-400" />
                Works 100% in your browser
              </span>
              <span className="flex items-center gap-1 bg-gray-800 text-green-400 px-3 py-1 rounded-full text-xs font-semibold border border-green-700">
                <Check className="w-4 h-4 inline-block mr-1 text-green-400" />
                No login required
              </span>
              <span className="flex items-center gap-1 bg-gray-800 text-green-400 px-3 py-1 rounded-full text-xs font-semibold border border-green-700">
                <Shield className="w-4 h-4 inline-block mr-1 text-green-400" />
                No data collection
              </span>
            </div>
          </div>
          <p className="text-base text-gray-400 mb-2 md:mb-4">Just drop your Instagram zip file or the JSON files here. We'll handle the rest. Your data stays on your device.</p>
          {/* How it works / FAQ link */}
          <div className="mb-4">
            <button
              className="text-teal-400 hover:underline text-sm font-medium focus:outline-none"
              onClick={() => setShowHelp(v => !v)}
              aria-expanded={showHelp}
              aria-controls="privacy-faq"
            >
              How does this work?
            </button>
            {showHelp && (
              <div id="privacy-faq" className="mt-2 bg-gray-800 rounded p-4 text-sm text-gray-300 max-w-md mx-auto text-left shadow-lg border border-gray-700">
                <div className="mb-2 font-semibold text-teal-300">Why do I need to upload my data?</div>
                <div className="mb-2">
                  Instagram doesn't let third-party tools access your follower info directly.<br />
                  This tool uses the official data download that you request from Instagram. No login or scraping needed.
                </div>
                <div className="mb-2 font-semibold text-teal-300">How it works</div>
                <div>
                  You download your data from Instagram, then upload it here.<br />
                  Everything is processed right in your browser. Nothing is sent anywhere.
                </div>
              </div>
            )}
          </div>
          <div className="mt-0 border-dashed border-2 border-teal-400 rounded-xl shadow-md hover:shadow-lg transition bg-gray-900 p-6 flex flex-col items-center">
            {/* Upload UI (drag/drop or browse) */}
            <div className="w-full flex flex-col items-center">
              <div
                className={`upload-zone ${isDragOver ? 'dragover' : ''} transition-all duration-200 ease-in-out ${isProcessing ? 'opacity-50 pointer-events-none' : ''} text-lg`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                tabIndex={0}
                style={{ paddingTop: '1.5rem', paddingBottom: '1.5rem' }}
              >
                <Upload className={`w-14 h-14 text-teal-400 mx-auto mb-4 transition-all duration-200 ease-in-out hover:scale-105 ${results ? 'animate-bounce' : ''}`} />
                <p className="text-xl font-bold text-white mb-2">
                  📂 Drop your Instagram zip or JSON files here
                </p>
                <p className="text-base text-white mb-4">
                  or <button className="text-teal-400 hover:underline font-medium transition-all duration-200 ease-in-out" onClick={() => fileInputRef.current && fileInputRef.current.click()}>browse files</button>
                </p>
                {/* File Count Display */}
                {uploadedFileCount > 0 && (
                  <div className="mt-4 text-sm text-teal-400">
                    Found {uploadedFileCount} valid file{uploadedFileCount !== 1 ? 's' : ''}
                  </div>
                )}
                {/* Hidden File Input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".json,.zip"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {results && (
                  <div className="mt-4 text-green-400 text-sm font-semibold">Files uploaded successfully! You can now review your results below.</div>
                )}
              </div>
              <div className="mt-3 text-sm text-green-400 text-center max-w-xs mx-auto">
                We only need following.json and any followers_1.json, followers_2.json, and so on. You can upload the zip or just those files. We ignore everything else.
              </div>
              <div className="mt-2 flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none" onClick={() => setShowMoreInfo(v => !v)}>
                <Info className="w-4 h-4 inline-block" />
                <span>More info</span>
                <span className={`transition-transform duration-200 ${showMoreInfo ? 'rotate-180' : ''}`}>▾</span>
              </div>
              {showMoreInfo && (
                <div className="mt-2 bg-gray-800 rounded p-3 text-xs text-gray-300 text-left max-w-md mx-auto transition-all duration-300">
                  <div className="mb-1 font-semibold text-teal-300">What files do I need?</div>
                  <ul className="list-disc list-inside ml-4 mb-2">
                    <li>following.json</li>
                    <li>followers_1.json, followers_2.json, and so on</li>
                  </ul>
                  <div className="mb-1 font-semibold text-teal-300">You can upload:</div>
                  <ul className="list-disc list-inside ml-4 mb-2">
                    <li>The Instagram zip file</li>
                    <li>Or just the above JSON files directly</li>
                  </ul>
                  <div className="mb-1 font-semibold text-teal-300">Tips:</div>
                  <ul className="list-disc list-inside ml-4">
                    <li>If you have a lot of followers, Instagram splits them into multiple files like followers_1.json, followers_2.json, etc. Make sure to include all of them.</li>
                    <li>We ignore any other files from your export, so don't worry about them.</li>
                  </ul>
                </div>
              )}
            </div>
            {/* Ethos line under upload UI */}
            <div className="mt-4 text-sm italic text-gray-500 text-center">
              Your feed should reflect your life, not a number.
            </div>
          </div>
        </div>

        {/* Results Section - moved up, right after upload UI */}
        {results && (
          <div ref={resultsRef} className={`transition-all duration-700 ease-in-out ${showResults ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} py-20`} id="results-section">
            {results.message ? (
              <div className="text-center max-w-2xl mx-auto">
                <div className="text-2xl font-bold text-white mb-4">{results.message}</div>
                {results.subtext && (
                  <div className="text-lg text-gray-400 mb-6">{results.subtext}</div>
                )}
                {/* If no unmatched followers, show Review Followers button here */}
                {(!results.notFollowingBack?.length && !results.youDontFollowBack?.length) && (
                  <div className="flex justify-center mt-6 mb-4">
                    <button
                      onClick={() => setShowCleanupTool(!showCleanupTool)}
                      className="btn-primary text-base px-6 py-3 rounded-lg shadow-md"
                    >
                      Review followers
                    </button>
                  </div>
                )}
              </div>
            ) : null}
            {/* Results Tabs */}
            {(results.notFollowingBack?.length > 0 || results.youDontFollowBack?.length > 0) && (
              <div className="flex flex-col md:flex-row gap-8 mt-10">
                {results.notFollowingBack?.length > 0 && (
                  <div className="flex-1">
                    <div className="mb-4 flex items-center gap-2">
                      <UserX className="w-6 h-6 text-red-500" />
                      <h3 className="heading-3">Users you follow who don't follow you back ({results.notFollowingBack.length})</h3>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {results.notFollowingBack.map((username, idx) => (
                        <div key={username + idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                          <a
                            href={`https://instagram.com/${username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium flex items-center min-w-0"
                          >
                            <span className="truncate">@{username}</span>
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {results.youDontFollowBack?.length > 0 && (
                  <div className="flex-1">
                    <div className="mb-4 flex items-center gap-2">
                      <UserCheck className="w-6 h-6 text-green-500" />
                      <h3 className="heading-3">Users who follow you that you don't follow back ({results.youDontFollowBack.length})</h3>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {results.youDontFollowBack.map((username, idx) => (
                        <div key={username + idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                          <a
                            href={`https://instagram.com/${username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium flex items-center min-w-0"
                          >
                            <span className="truncate">@{username}</span>
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Review followers button below results if there are unmatched followers */}
            {(results.notFollowingBack?.length > 0 || results.youDontFollowBack?.length > 0) && (
              <div className="flex justify-center mt-10 mb-4">
                <button
                  onClick={() => setShowCleanupTool(!showCleanupTool)}
                  className="btn-primary text-base px-6 py-3 rounded-lg shadow-md"
                >
                  Review followers
                </button>
              </div>
            )}
            {/* Expanded following list (cleanup tool) directly after the button, not at the bottom */}
            {showCleanupTool && (
              <div className="mt-6 max-w-2xl mx-auto">
                <div className="bg-gray-900 rounded-xl p-6">
                  <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg">
                    <p className="text-blue-600 dark:text-blue-400 text-sm">
                      We'll never judge. This is your space to reflect and keep your feed meaningful.
                    </p>
                  </div>
                  {/* Search Bar */}
                  <div className="relative mb-6">
                    <input
                      type="text"
                      placeholder="Search usernames..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                    />
                    <Search className="absolute right-3 top-2.5 w-5 h-5 text-gray-400" />
                  </div>
                  {/* Following List */}
                  <div className="space-y-2">
                    {isLoadingFollowing ? (
                      <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mx-auto"></div>
                        <p className="mt-2 text-gray-400">Loading your following list...</p>
                      </div>
                    ) : followingList.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-gray-400">We couldn't detect any accounts you follow. Try re-uploading your export file.</p>
                      </div>
                    ) : (
                      <div className="max-h-[60vh] overflow-y-auto pr-2">
                        {followingList
                          .filter(user => user.toLowerCase().includes(searchTerm.toLowerCase()))
                          .map((username, index) => (
                            <a
                              key={index}
                              href={`https://instagram.com/${username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block p-3 hover:bg-gray-800 rounded-lg transition-colors group"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-white group-hover:text-teal-400 transition-colors">@{username}</span>
                                <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-teal-400 transition-colors" />
                              </div>
                            </a>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Visual divider */}
        <div className="my-10 mx-auto max-w-2xl border-t border-white/10 opacity-40" />
        {/* Instructions Section */}
        <section className="bg-gray-900 rounded-2xl shadow-lg shadow-white/5 ring-1 ring-white/10 p-6 max-w-2xl mx-auto mb-16 mt-0 instruction-section">
          <h2 className="text-xl font-bold text-white mb-4">How to get your Instagram data</h2>
          <ol className="space-y-3 text-base text-white text-left">
            <li><span className="font-bold text-teal-300 mr-2">1.</span> Go to <span className="font-semibold">Settings and activity → Accounts Center</span> in Instagram.</li>
            <li><span className="font-bold text-teal-300 mr-2">2.</span> Tap <span className="font-semibold">Your information and permissions → Download your information</span>.</li>
            <li><span className="font-bold text-teal-300 mr-2">3.</span> Select <span className="font-semibold">Download or transfer information → Some of your information</span>.</li>
            <li><span className="font-bold text-teal-300 mr-2">4.</span> Scroll down and check only <span className="font-semibold">Connections → Followers and Following</span>.</li>
            <li><span className="font-bold text-teal-300 mr-2">5.</span> Tap <span className="font-semibold">Next</span>, then set <span className="font-semibold">Format: JSON</span> and <span className="font-semibold">Destination: Download to device</span>.</li>
            <li><span className="font-bold text-teal-300 mr-2">6.</span> Tap <span className="font-semibold">Create files</span>. Instagram will prepare the download.</li>
            <li><span className="font-bold text-teal-300 mr-2">7.</span> When your download is ready, upload the zip file here. If you unzip it, just select the files named following.json and followers_1.json, followers_2.json, and so on.</li>
          </ol>
        </section>

        {/* Mobile Screenshot Section (replace with GIF demo) */}
        <section className="py-8 md:py-12">
          <div className="max-w-2xl mx-auto flex flex-col items-center">
            <img
              src="/Demo.gif"
              alt="Demo showing Instagram data file upload"
              className="rounded-xl w-full max-w-md object-cover shadow-lg border border-gray-800"
              style={{ margin: '0 auto' }}
            />
          </div>
        </section>

        {/* Toast */}
        {toast && (
          <div className={`toast ${toast.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400'} transition-all duration-200`}> 
            {toast.message}
          </div>
        )}

        {/* Supportive Ethos Statement */}
        <div className="text-sm text-gray-500 text-center max-w-md mx-auto mt-12">
          "Clear your digital space. Your energy belongs to you. We're just here to help you focus it."
        </div>

        {/* Legal Disclaimer */}
        <div className="text-xs text-gray-500 text-center max-w-xl mx-auto mt-8 mb-4 px-2">
          This tool is not affiliated with, endorsed by, or connected to Instagram or Meta. It only uses data that you download yourself using Instagram's official export feature.
        </div>

        {/* Footer */}
        <footer className="flex flex-col items-center justify-center gap-2 text-sm text-gray-500 mt-12 pt-6 border-t border-white/10">
          <div className="flex justify-center gap-6 mb-2">
            <a href="https://github.com/zlizzle/Follower-Checker" target="_blank" rel="noopener noreferrer" className="hover:text-teal-400 transition-all duration-200 ease-in-out flex items-center gap-1">
              <span>⭐</span> Star on GitHub
            </a>
            <a href="https://buymeacoffee.com/slizzle" target="_blank" rel="noopener noreferrer" className="hover:text-teal-400 transition-all duration-200 ease-in-out flex items-center gap-1">
              <span>☕</span> Buy me a coffee
        </a>
      </div>
          <div className="text-xs text-gray-400 text-center">
            Made with privacy in mind. No data leaves your browser.<br />
          </div>
        </footer>

        {/* Error Toast */}
        {error && (
          <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
            <div className="bg-red-600 text-white border border-red-700 px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 max-w-md" style={{ backgroundColor: '#dc2626', borderColor: '#991b1b', opacity: 1 }}>
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="flex-1">{error}</p>
              <button 
                onClick={() => setError(null)}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Warning Toast */}
        {warning && (
          <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
            <div className="bg-yellow-500 text-white px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 max-w-md">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="flex-1">{warning}</p>
              <button 
                onClick={() => setWarning(null)}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App
